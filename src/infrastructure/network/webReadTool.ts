import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';

type AddressLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CONTENT_BYTES = 48 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

/**
 * Synchronous check for hosts that are private without a DNS lookup: local names and
 * private IP literals. Used where a lookup is not possible (a browser request filter).
 */
export function isBlockedHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  return isIP(hostname) !== 0 && isPrivateAddress(hostname);
}

async function defaultLookup(hostname: string): Promise<Array<{ address: string }>> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function assertPublicHttpUrl(rawUrl: string, lookup: AddressLookup): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('web.read supports only HTTP and HTTPS URLs');
  if (url.username || url.password) throw new Error('web.read does not accept credentials in URLs');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('web.read blocks local and private destinations');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('web.read blocks local and private destinations');
  }
  return url;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const numeric = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

function htmlToReadableText(html: string): { title?: string; content: string } {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtml(titleMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : undefined;
  const content = decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:article|aside|blockquote|br|div|footer|h[1-6]|header|li|main|nav|p|section|table|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ...(title ? { title } : {}), content };
}

// Some publishers answer 403 to anything that does not look like a browser.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8',
};
const RENDER_FALLBACK_STATUSES = new Set([401, 403, 429, 503]);
// Pages built client-side return a near-empty shell to a plain HTTP fetch.
const MIN_READABLE_CHARACTERS = 400;

export type RenderedPage = { url: string; title?: string; text: string };
/** Loads a page in a real, isolated browser engine; used when a plain fetch is refused. */
export type PageRenderer = (url: URL, signal: AbortSignal) => Promise<RenderedPage>;

function truncateUtf8(value: string): { content: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= MAX_CONTENT_BYTES) return { content: value, truncated: false };
  return { content: bytes.subarray(0, MAX_CONTENT_BYTES).toString('utf8'), truncated: true };
}

export function createWebReadTool(
  fetchImpl: typeof fetch = fetch,
  lookup: AddressLookup = defaultLookup,
  renderPage?: PageRenderer,
): AgentTool<{ url: string }, ToolResult> {
  const pageResult = (url: URL, title: string | undefined, text: string, rendered: boolean): ToolResult => {
    const bounded = truncateUtf8(text);
    return {
      output: {
        url: url.toString(),
        ...(title ? { title } : {}),
        content: bounded.content,
        truncated: bounded.truncated,
        ...(rendered ? { rendered: true } : {}),
      },
      sourceReferences: [{ type: 'web', url: url.toString(), label: title ?? url.hostname }],
    };
  };
  const render = async (url: URL, signal: AbortSignal): Promise<ToolResult> => {
    if (!renderPage) throw new Error('web.read cannot render pages in this environment');
    const page = await renderPage(url, signal);
    const finalUrl = await assertPublicHttpUrl(page.url, lookup);
    return pageResult(finalUrl, page.title, page.text.trim(), true);
  };
  return {
    id: 'web.read',
    description: 'Read a user-relevant public web page without authentication or side effects',
    inputSchema: z.object({ url: z.string().url().max(2_048) }),
    inputJsonSchema: {
      type: 'object',
      properties: { url: { type: 'string', format: 'uri', maxLength: 2_048 } },
      required: ['url'],
      additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
    async execute({ url: rawUrl }, context): Promise<ToolResult> {
      let current = await assertPublicHttpUrl(rawUrl, lookup);
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          headers: BROWSER_HEADERS,
          signal: AbortSignal.any([context.signal, timeout]),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new Error(`web.read redirect ${response.status} did not include a location`);
          if (redirect === MAX_REDIRECTS) throw new Error('web.read followed too many redirects');
          current = await assertPublicHttpUrl(new URL(location, current).toString(), lookup);
          continue;
        }
        if (!response.ok) {
          if (renderPage && RENDER_FALLBACK_STATUSES.has(response.status)) return render(current, context.signal);
          throw new Error(`web.read request failed with HTTP ${response.status}`);
        }
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        // legislation.gov.uk and similar sites serve pages as application/xhtml+xml.
        if (contentType && !contentType.includes('text/') && !contentType.includes('json') && !contentType.includes('xml')) {
          throw new Error(`web.read cannot process content type ${contentType}`);
        }
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('web.read response is too large');
        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error('web.read response is too large');
        const decoded = body.toString('utf8');
        const html = contentType.includes('html');
        const readable = html ? htmlToReadableText(decoded) : { content: decoded.trim() };
        if (html && renderPage && readable.content.length < MIN_READABLE_CHARACTERS) {
          try {
            return await render(current, context.signal);
          } catch {
            // The thin fetched text is still better than nothing.
          }
        }
        return pageResult(current, readable.title, readable.content, false);
      }
      throw new Error('web.read could not resolve the requested page');
    },
  };
}

export const webReadTool = createWebReadTool();

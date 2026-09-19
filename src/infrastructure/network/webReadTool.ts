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

function truncateUtf8(value: string): { content: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= MAX_CONTENT_BYTES) return { content: value, truncated: false };
  return { content: bytes.subarray(0, MAX_CONTENT_BYTES).toString('utf8'), truncated: true };
}

export function createWebReadTool(
  fetchImpl: typeof fetch = fetch,
  lookup: AddressLookup = defaultLookup,
): AgentTool<{ url: string }, ToolResult> {
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
          headers: { Accept: 'text/html, text/plain, application/json;q=0.9' },
          signal: AbortSignal.any([context.signal, timeout]),
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new Error(`web.read redirect ${response.status} did not include a location`);
          if (redirect === MAX_REDIRECTS) throw new Error('web.read followed too many redirects');
          current = await assertPublicHttpUrl(new URL(location, current).toString(), lookup);
          continue;
        }
        if (!response.ok) throw new Error(`web.read request failed with HTTP ${response.status}`);
        const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
        if (contentType && !contentType.includes('text/') && !contentType.includes('json')) {
          throw new Error(`web.read cannot process content type ${contentType}`);
        }
        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > MAX_RESPONSE_BYTES) throw new Error('web.read response is too large');
        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error('web.read response is too large');
        const decoded = body.toString('utf8');
        const readable = contentType.includes('html') ? htmlToReadableText(decoded) : { content: decoded.trim() };
        const bounded = truncateUtf8(readable.content);
        return {
          output: {
            url: current.toString(),
            ...(readable.title ? { title: readable.title } : {}),
            content: bounded.content,
            truncated: bounded.truncated,
          },
          sourceReferences: [{ type: 'web', url: current.toString(), label: readable.title ?? current.hostname }],
        };
      }
      throw new Error('web.read could not resolve the requested page');
    },
  };
}

export const webReadTool = createWebReadTool();

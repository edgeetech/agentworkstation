import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESULTS = 10;
const SEARCH_ENDPOINT = 'https://www.bing.com/search';

export type WebSearchResult = { title: string; url: string; snippet: string; published?: string };

function decodeXml(value: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
      const numeric = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(item: string, name: string): string | undefined {
  const match = item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decodeXml(match[1]) : undefined;
}

export function parseSearchRss(xml: string, limit = MAX_RESULTS): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = tag(item, 'title');
    const url = tag(item, 'link');
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const published = tag(item, 'pubDate');
    results.push({ title, url, snippet: tag(item, 'description') ?? '', ...(published ? { published } : {}) });
    if (results.length >= limit) break;
  }
  return results;
}

export function createWebSearchTool(fetchImpl: typeof fetch = fetch): AgentTool<{ query: string; limit?: number }, ToolResult> {
  return {
    id: 'web.search',
    description: 'Search the public web and return result titles, URLs and snippets. Follow up with web.read on the most relevant URLs.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
      limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
    }),
    inputJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: 8 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: false },
    async execute({ query, limit }, context): Promise<ToolResult> {
      const url = new URL(SEARCH_ENDPOINT);
      url.searchParams.set('format', 'rss');
      url.searchParams.set('q', query);
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5',
        },
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error(`web.search failed with HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error('web.search response is too large');
      const results = parseSearchRss(body.toString('utf8'), limit ?? 8);
      return {
        output: { query, results, ...(results.length === 0 ? { note: 'No results. Try different or fewer keywords.' } : {}) },
        sourceReferences: [{ type: 'web', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`, label: `web.search: ${query}` }],
      };
    },
  };
}

export const webSearchTool = createWebSearchTool();

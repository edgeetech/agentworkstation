import { describe, expect, it } from 'vitest';
import { createWebSearchTool, parseSearchRss } from '../../src/infrastructure/network/webSearchTool';

const rss = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing</title>
<item><title>Introducing dots | OpenAI</title><link>https://openai.com/index/introducing-dots/</link>
<description>Dots are always-on agents &amp; more.</description><pubDate>Tue, 29 Sep 2026 17:00:00 GMT</pubDate></item>
<item><title>No link</title><description>skip me</description></item>
<item><title>Coverage</title><link>https://example.com/dots</link><description><![CDATA[<b>Dots</b> review]]></description></item>
</channel></rss>`;

describe('web.search', () => {
  it('parses titles, links, snippets and dates from an RSS result page', () => {
    expect(parseSearchRss(rss)).toEqual([
      { title: 'Introducing dots | OpenAI', url: 'https://openai.com/index/introducing-dots/', snippet: 'Dots are always-on agents & more.', published: 'Tue, 29 Sep 2026 17:00:00 GMT' },
      { title: 'Coverage', url: 'https://example.com/dots', snippet: 'Dots review' },
    ]);
  });

  it('queries the RSS endpoint and cites the search', async () => {
    let requested = '';
    const fetchImpl = (async (input: URL) => {
      requested = input.toString();
      return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }) as unknown as typeof fetch;
    const result = await createWebSearchTool(fetchImpl).execute({ query: 'openai dots', limit: 1 }, { signal: new AbortController().signal, workspaceId: '' });
    expect(requested).toContain('format=rss');
    expect(requested).toContain('q=openai+dots');
    expect(result.output).toEqual({ query: 'openai dots', results: [expect.objectContaining({ url: 'https://openai.com/index/introducing-dots/' })] });
    expect(result.sourceReferences[0]).toMatchObject({ type: 'web', label: 'web.search: openai dots' });
  });

  it('tells the model to rephrase when nothing is found', async () => {
    const fetchImpl = (async () => new Response('<rss><channel></channel></rss>', { status: 200 })) as unknown as typeof fetch;
    const result = await createWebSearchTool(fetchImpl).execute({ query: 'zzz' }, { signal: new AbortController().signal, workspaceId: '' });
    expect(result.output).toMatchObject({ results: [], note: expect.stringContaining('different') });
  });
});

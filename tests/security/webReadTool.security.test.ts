import { describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from '../../src/application/intelligence';
import { AgentPolicyGate, ToolExecutor, ToolRegistry, type ToolResult } from '../../src/application/tools';
import { createWebReadTool, isBlockedHostname } from '../../src/infrastructure/network/webReadTool';

const publicLookup = async () => [{ address: '93.184.216.34' }];
const context = () => ({ workspaceId: '', signal: new AbortController().signal });

describe('web.read security', () => {
  it('is available to an agent runtime without a local workspace', async () => {
    const registry = new ToolRegistry();
    registry.register(createWebReadTool(
      vi.fn(async () => new Response('<main>Published article</main>', { headers: { 'content-type': 'text/html' } })) as typeof fetch,
      publicLookup,
    ));
    const executor = new ToolExecutor(registry);
    const runtime = new AgentRuntime(
      {
        execute: vi.fn()
          .mockResolvedValueOnce({ type: 'tool_call', call: { id: 'read-1', toolName: 'web.read', input: { url: 'https://asozyurt.com/writing/' } } })
          .mockResolvedValueOnce({ type: 'text', content: 'I found the published article.' }),
      },
      executor,
      new AgentPolicyGate({ 'web.read': 'allow' }),
      { maxSteps: 3, maxToolCalls: 2, maxToolResultBytes: 64 * 1024, modelTimeoutMs: 1_000, toolTimeoutMs: 1_000 },
    );

    await expect(runtime.run(
      { messages: [{ role: 'user', content: 'Read my writing page.' }], tools: registry.getModelTools() },
      { modelId: 'mock', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toBe('I found the published article.');
  });

  it('reads and bounds a public HTML page with provenance', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      '<html><head><title>Writing</title><style>hidden</style></head><body><main><h1>Latest article</h1><p>Useful text.</p><script>bad()</script></main></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    ));
    const result = await createWebReadTool(fetchImpl as typeof fetch, publicLookup)
      .execute({ url: 'https://asozyurt.com/writing/' }, context()) as ToolResult;

    expect(result.output).toMatchObject({
      url: 'https://asozyurt.com/writing/',
      title: 'Writing',
      content: expect.stringContaining('Latest article'),
      truncated: false,
    });
    expect(JSON.stringify(result.output)).not.toContain('hidden');
    expect(JSON.stringify(result.output)).not.toContain('bad()');
    expect(result.sourceReferences).toEqual([{
      type: 'web',
      url: 'https://asozyurt.com/writing/',
      label: 'Writing',
    }]);
  });

  it.each([
    'http://localhost:3000/private',
    'http://127.0.0.1/private',
    'http://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
    'https://user:secret@example.com/private',
  ])('blocks unsafe destination %s before fetch', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const tool = createWebReadTool(fetchImpl, publicLookup);

    await expect(tool.execute({ url }, context())).rejects.toThrow(/blocks local|supports only|credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks hostnames that resolve to private addresses', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const tool = createWebReadTool(fetchImpl, async () => [{ address: '10.0.0.8' }]);

    await expect(tool.execute({ url: 'https://internal.example/' }, context())).rejects.toThrow('blocks local and private');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('revalidates redirect destinations before following them', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }));
    const tool = createWebReadTool(fetchImpl as typeof fetch, publicLookup);

    await expect(tool.execute({ url: 'https://example.com/' }, context())).rejects.toThrow('blocks local and private');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('renders a page in the isolated browser when a plain fetch is refused', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked', { status: 403, headers: { 'content-type': 'text/html' } }));
    const renderPage = vi.fn(async (url: URL) => ({ url: url.toString(), title: 'Introducing dots', text: 'Dots are always-on agents.' }));
    const result = await createWebReadTool(fetchImpl as typeof fetch, publicLookup, renderPage)
      .execute({ url: 'https://openai.com/index/introducing-dots/' }, context()) as ToolResult;
    expect(renderPage).toHaveBeenCalledOnce();
    expect(result.output).toMatchObject({ title: 'Introducing dots', content: 'Dots are always-on agents.', rendered: true });
  });

  it('rejects a rendered page that ended up on a private destination', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked', { status: 403 }));
    const renderPage = vi.fn(async () => ({ url: 'http://127.0.0.1/admin', text: 'secret' }));
    await expect(createWebReadTool(fetchImpl as typeof fetch, publicLookup, renderPage)
      .execute({ url: 'https://example.com/' }, context())).rejects.toThrow(/blocks local/);
  });

  it('still reports the HTTP error when no renderer is available', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked', { status: 403 }));
    await expect(createWebReadTool(fetchImpl as typeof fetch, publicLookup)
      .execute({ url: 'https://example.com/' }, context())).rejects.toThrow('HTTP 403');
  });

  it('blocks local names and private IP literals without a DNS lookup', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('printer.local')).toBe(true);
    expect(isBlockedHostname('192.168.1.10')).toBe(true);
    expect(isBlockedHostname('[::1]')).toBe(true);
    expect(isBlockedHostname('openai.com')).toBe(false);
    expect(isBlockedHostname('93.184.216.34')).toBe(false);
  });

  it('reads XHTML pages such as legislation.gov.uk', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      '<html><head><title>Companies Act 2006</title></head><body><main>853L Failure to deliver confirmation statement</main></body></html>',
      { status: 200, headers: { 'content-type': 'application/xhtml+xml;charset=utf-8' } },
    ));
    const result = await createWebReadTool(fetchImpl as typeof fetch, publicLookup)
      .execute({ url: 'https://www.legislation.gov.uk/ukpga/2006/46/section/853L' }, context()) as ToolResult;
    expect(result.output).toMatchObject({ title: 'Companies Act 2006', content: expect.stringContaining('853L') });
  });
});

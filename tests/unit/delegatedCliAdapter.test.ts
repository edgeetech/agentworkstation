import { describe, expect, it, vi } from 'vitest';
import {
  DelegatedCliIntelligenceAdapter,
  delegatedProviders,
  getDelegatedProvider,
  parseDelegatedModelResponse,
  type CliProcessRunner,
} from '../../src/infrastructure/intelligence/delegatedCliAdapter';

describe('delegated CLI intelligence adapter', () => {
  it('keeps provider definitions unique and provider-native tools disabled', () => {
    expect(new Set(delegatedProviders.map((provider) => provider.id)).size).toBe(delegatedProviders.length);
    expect(getDelegatedProvider('codex').buildArgs('default')).toEqual(expect.arrayContaining([
      '--ephemeral', '--sandbox', 'read-only', '--ignore-user-config', '--ignore-rules',
    ]));
    expect(getDelegatedProvider('copilot').buildArgs('auto')).toEqual(expect.arrayContaining([
      '--no-custom-instructions', '--disable-builtin-mcps', '--available-tools=',
    ]));
    expect(getDelegatedProvider('claude').buildArgs('default')).toEqual(expect.arrayContaining([
      '--tools=', '--safe-mode', '--no-session-persistence',
    ]));
    expect(getDelegatedProvider('devin').buildArgs('default')).toEqual(expect.arrayContaining([
      '--permission-mode', 'auto', '--print',
    ]));
    expect(getDelegatedProvider('devin').discoverDefaultModel?.('Default model: claude-sonnet-4-6-thinking'))
      .toBe('claude-sonnet-4-6-thinking');
  });

  it('passes Devin prompts as a non-interactive argument', async () => {
    const run = vi.fn(async (_command: string, _args: string[], _stdin: string, _signal: AbortSignal) => ({
      stdout: '{"type":"text","content":"provider answer"}', stderr: '', exitCode: 0,
    }));
    const adapter = new DelegatedCliIntelligenceAdapter(getDelegatedProvider('devin'), { run });
    await adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    );
    expect(run.mock.calls[0][1]).toEqual(expect.arrayContaining(['--permission-mode', 'auto', '--print', '--']));
    expect(run.mock.calls[0][1].at(-1)).toContain('Do not use your own tools');
    expect(run.mock.calls[0][2]).toBe('');
  });

  it('unwraps Claude JSON output through its provider definition', () => {
    expect(getDelegatedProvider('claude').parseOutput('{"result":"{\\"type\\":\\"text\\",\\"content\\":\\"hello\\"}"}'))
      .toBe('{"type":"text","content":"hello"}');
  });

  it('normalizes text and tool-call envelopes', () => {
    expect(parseDelegatedModelResponse('```json\n{"type":"text","content":"hello"}\n```'))
      .toEqual({ type: 'text', content: 'hello' });
    expect(parseDelegatedModelResponse('{"type":"tool_call","call":{"id":"c1","toolName":"git.log","input":{"maxCount":2}}}'))
      .toEqual({ type: 'tool_call', call: { id: 'c1', toolName: 'git.log', input: { maxCount: 2 } } });
  });

  it('blocks delegated execution under local-only policy', async () => {
    const runner: CliProcessRunner = { run: vi.fn() };
    const adapter = new DelegatedCliIntelligenceAdapter(getDelegatedProvider('codex'), runner);
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'default', executionMode: 'local_only' },
      new AbortController().signal,
    )).rejects.toThrow('blocked by local_only');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('passes only the normalized prompt through the provider runner', async () => {
    const run = vi.fn(async (_command: string, _args: string[], _stdin: string, _signal: AbortSignal) => ({
      stdout: '{"type":"text","content":"provider answer"}', stderr: '', exitCode: 0,
    }));
    const adapter = new DelegatedCliIntelligenceAdapter(getDelegatedProvider('copilot'), { run });
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hello' }] },
      { modelId: 'auto', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'text', content: 'provider answer' });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][2]).toContain('Do not use your own tools');
  });
});

describe('Codex JSON output', () => {
  const jsonl = [
    '{"type":"thread.started","thread_id":"t1"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"type\\":\\"text\\",\\"content\\":\\"ok\\"}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":13921,"cached_input_tokens":11776,"cache_write_input_tokens":0,"output_tokens":13,"reasoning_output_tokens":7}}',
  ].join('\r\n');

  it('runs Codex in JSON mode and reads the final agent message and token usage', async () => {
    const run = vi.fn(async (_command: string, _args: string[], _stdin: string, _signal: AbortSignal) => ({ stdout: jsonl, stderr: '', exitCode: 0 }));
    const adapter = new DelegatedCliIntelligenceAdapter(getDelegatedProvider('codex'), { run });
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).resolves.toEqual({ type: 'text', content: 'ok' });
    expect(run.mock.calls[0]?.[1]).toContain('--json');
    expect(adapter.getLastUsage()).toEqual({ totalCostUsd: null, model: null, tokens: { input: 13921, cachedInput: 11776, output: 20 } });
  });

  it('fails clearly when Codex produced no agent message', async () => {
    const run = vi.fn(async () => ({ stdout: '{"type":"turn.completed","usage":{}}', stderr: '', exitCode: 0 }));
    const adapter = new DelegatedCliIntelligenceAdapter(getDelegatedProvider('codex'), { run });
    await expect(adapter.execute(
      { messages: [{ role: 'user', content: 'hi' }] },
      { modelId: 'default', executionMode: 'provider_allowed' },
      new AbortController().signal,
    )).rejects.toThrow('returned no message');
  });
});

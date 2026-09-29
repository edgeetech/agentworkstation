import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../src/application/context';

describe('ContextBuilder', () => {
  it('builds deterministic career memory with explicit provenance', () => {
    const result = new ContextBuilder().buildMemory([
      { relativePath: 'memory/z.md', content: 'Z' },
      { relativePath: 'memory/a.md', content: 'A' },
    ], 1024);

    expect(result.content.indexOf('memory/a.md')).toBeLessThan(result.content.indexOf('memory/z.md'));
    expect(result.sourceReferences).toEqual([
      { type: 'memory', relativePath: 'memory/a.md', label: 'memory/a.md' },
      { type: 'memory', relativePath: 'memory/z.md', label: 'memory/z.md' },
    ]);
    expect(result.byteLength).toBe(Buffer.byteLength(result.content, 'utf8'));
    expect(result.truncated).toBe(false);
  });

  it('enforces a UTF-8 byte budget and reports truncation', () => {
    const result = new ContextBuilder().buildMemory([
      { relativePath: 'memory/profile.md', content: 'é'.repeat(100) },
      { relativePath: 'memory/skills.md', content: 'not included' },
    ], 48);

    expect(result.byteLength).toBeLessThanOrEqual(48);
    expect(Buffer.from(result.content, 'utf8').toString('utf8')).toBe(result.content);
    expect(result.truncated).toBe(true);
    expect(result.sourceReferences).toEqual([
      { type: 'memory', relativePath: 'memory/profile.md', label: 'memory/profile.md' },
    ]);
  });

  it('rejects invalid byte budgets', () => {
    expect(() => new ContextBuilder().buildMemory([], -1)).toThrow('Context byte budget');
  });

  it('composes a request within category budgets and keeps the newest conversation', () => {
    const builder = new ContextBuilder();
    const memoryContext = builder.buildMemory([
      { relativePath: 'memory/profile.md', content: 'Current profile' },
    ], 1024);
    const result = builder.buildRequest({
      systemPrompt: 'Trusted instructions',
      memoryContext,
      conversation: [
        { role: 'user', content: 'old message that does not fit' },
        { role: 'assistant', content: 'old reply that does not fit' },
        { role: 'user', content: 'latest' },
      ],
    }, {
      maxInstructionsBytes: 64,
      maxMemoryBytes: 64,
      maxConversationBytes: 8,
      maxToolResultBytes: 32,
      maxTotalContentBytes: 168,
    });

    expect(result.request.messages.at(-1)).toEqual({ role: 'user', content: 'latest' });
    expect(result.request.messages.some((message) => message.content.includes('old message'))).toBe(false);
    expect(result.usage.conversationBytes).toBe(6);
    expect(result.truncated).toContain('conversation');
    expect(result.sourceReferences).toEqual(memoryContext.sourceReferences);
  });

  it('drops an oversized assistant/tool pair atomically', () => {
    const result = new ContextBuilder().buildRequest({
      systemPrompt: '',
      memoryContext: { content: '', byteLength: 0, truncated: false, sourceReferences: [] },
      conversation: [
        { role: 'assistant', content: '', toolCalls: [{ id: '1', toolName: 'git.log', input: {} }] },
        { role: 'tool', content: 'oversized result', toolCallId: '1', toolName: 'git.log' },
        { role: 'user', content: 'continue' },
      ],
    }, {
      maxInstructionsBytes: 0,
      maxMemoryBytes: 0,
      maxConversationBytes: 16,
      maxToolResultBytes: 4,
      maxTotalContentBytes: 20,
    });

    expect(result.request.messages).toEqual([{ role: 'user', content: 'continue' }]);
    expect(result.truncated).toContain('toolResults');
  });

  it('rejects category budgets that exceed the total', () => {
    expect(() => new ContextBuilder().buildRequest({
      systemPrompt: '',
      memoryContext: { content: '', byteLength: 0, truncated: false, sourceReferences: [] },
      conversation: [],
    }, {
      maxInstructionsBytes: 1,
      maxMemoryBytes: 1,
      maxConversationBytes: 1,
      maxToolResultBytes: 1,
      maxTotalContentBytes: 3,
    })).toThrow('category budgets exceed');
  });

  it('keeps the head of an oversized older message and never skips past it to older turns', () => {
    const article = 'A'.repeat(4000);
    const result = new ContextBuilder().buildRequest({
      systemPrompt: '',
      memoryContext: { content: '', byteLength: 0, truncated: false, sourceReferences: [] },
      conversation: [
        { role: 'user', content: 'oldest short turn' },
        { role: 'user', content: article },
        { role: 'assistant', content: 'Which option?' },
        { role: 'user', content: '1' },
      ],
    }, {
      maxInstructionsBytes: 0,
      maxMemoryBytes: 0,
      maxConversationBytes: 2048,
      maxToolResultBytes: 0,
      maxTotalContentBytes: 2048,
    });

    const contents = result.request.messages.map((message) => message.content);
    expect(contents.at(-1)).toBe('1');
    expect(contents[0]?.startsWith('AAAA')).toBe(true);
    expect(contents[0]).toContain('[... truncated to fit the context budget]');
    expect(contents).not.toContain('oldest short turn');
    expect(result.usage.conversationBytes).toBeLessThanOrEqual(2048);
    expect(result.truncated).toContain('conversation');
  });
});

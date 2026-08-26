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
});

import { describe, expect, it } from 'vitest';
import { EnvelopeTextStream } from '../../src/infrastructure/intelligence/envelopeTextStream';

const run = (chunks: string[]): string => {
  let out = '';
  const stream = new EnvelopeTextStream((text) => { out += text; });
  for (const chunk of chunks) stream.push(chunk);
  return out;
};

describe('EnvelopeTextStream', () => {
  it('streams decoded content of a text envelope across arbitrary chunk boundaries', () => {
    const envelope = '{"type":"text","content":"Hello \\"world\\"\\nLine two \\u00e7 and \\\\ done"}';
    const expected = 'Hello "world"\nLine two ç and \\ done';
    expect(run([envelope])).toBe(expected);
    expect(run(envelope.split(''))).toBe(expected);
    expect(run([envelope.slice(0, 30), envelope.slice(30, 33), envelope.slice(33)])).toBe(expected);
  });

  it('tolerates whitespace and a json code fence around the envelope', () => {
    expect(run(['```json\n{ "type" : "text", ', '"content": "Hi"}\n```'])).toBe('Hi');
  });

  it('emits nothing for tool calls or unrecognised JSON', () => {
    expect(run(['{"type":"tool_call","call":{"id":"1","toolName":"git.log","input":{}}}'])).toBe('');
    expect(run(['{"content":"x","type":"text"}'])).toBe('');
  });

  it('streams a plain prose answer that has no envelope', () => {
    expect(run(['  Plain ', 'prose reply'])).toBe('Plain prose reply');
  });
});

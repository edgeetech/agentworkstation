/**
 * Delegated providers answer with a JSON envelope: {"type":"text","content":"..."}
 * or a tool call. This decoder watches raw model output as it streams and emits
 * the decoded characters of `content` only when the envelope is a final text
 * answer, so the UI can show the reply while it is being written. A reply with no
 * envelope at all is streamed as prose; tool calls and other JSON produce nothing.
 */
export class EnvelopeTextStream {
  private raw = '';
  private state: 'detecting' | 'streaming' | 'prose' | 'closed' | 'ignored' = 'detecting';
  private cursor = 0;

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string): void {
    this.raw += chunk;
    if (this.state === 'detecting') this.detect();
    if (this.state === 'streaming') this.decode();
    else if (this.state === 'prose') {
      this.emit(this.raw.slice(this.cursor));
      this.cursor = this.raw.length;
    }
  }

  private detect(): void {
    const lead = this.raw.trimStart();
    // Plain prose (no envelope at all) is itself the answer.
    if (lead && lead[0] !== '{' && lead[0] !== '`') {
      this.state = 'prose';
      this.cursor = this.raw.length - lead.length;
      return;
    }
    const text = this.raw.replace(/^\s*(?:```(?:json)?\s*)?/i, '');
    const offset = this.raw.length - text.length;
    const opening = /^\{\s*"type"\s*:\s*"text"\s*,\s*"content"\s*:\s*"/.exec(text);
    if (opening) {
      this.state = 'streaming';
      this.cursor = offset + opening[0].length;
      return;
    }
    // Still possibly a prefix of the text envelope: keep waiting.
    const target = '{"type":"text","content":"';
    const compact = text.replace(/\s+/g, '');
    if (compact.length < target.length ? target.startsWith(compact) : false) return;
    if (text.length < 8) return;
    this.state = 'ignored';
  }

  private decode(): void {
    let out = '';
    while (this.cursor < this.raw.length) {
      const char = this.raw[this.cursor]!;
      if (char === '"') {
        this.state = 'closed';
        break;
      }
      if (char !== '\\') {
        out += char;
        this.cursor += 1;
        continue;
      }
      const next = this.raw[this.cursor + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = this.raw.slice(this.cursor + 2, this.cursor + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.cursor += 6;
        continue;
      }
      const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
      out += escapes[next] ?? next;
      this.cursor += 2;
    }
    if (out) this.emit(out);
  }
}

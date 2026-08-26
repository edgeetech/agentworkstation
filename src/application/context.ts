import type { SourceReference } from '@domain/intelligence';
import type { AgentContentFile } from './agents/types';

export type BoundedContext = {
  content: string;
  byteLength: number;
  truncated: boolean;
  sourceReferences: SourceReference[];
};

function truncateUtf8(content: string, maxBytes: number): string {
  const encoded = Buffer.from(content, 'utf8');
  if (encoded.byteLength <= maxBytes) return content;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
}

export class ContextBuilder {
  buildMemory(files: AgentContentFile[], maxBytes: number): BoundedContext {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error('Context byte budget must be a non-negative safe integer');
    }

    const ordered = [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const included: string[] = [];
    const sourceReferences: SourceReference[] = [];
    let remainingBytes = maxBytes;
    let truncated = false;

    for (const file of ordered) {
      const separator = included.length > 0 ? '\n\n---\n\n' : '';
      const block = `### ${file.relativePath}\n\n${file.content}`;
      const candidate = separator + block;
      const selected = truncateUtf8(candidate, remainingBytes);
      if (selected) {
        included.push(selected);
        sourceReferences.push({ type: 'memory', relativePath: file.relativePath, label: file.relativePath });
        remainingBytes -= Buffer.byteLength(selected, 'utf8');
      }
      if (selected !== candidate) {
        truncated = true;
        break;
      }
    }

    if (sourceReferences.length < ordered.length) truncated = true;
    const content = included.join('');
    return {
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
      truncated,
      sourceReferences,
    };
  }
}


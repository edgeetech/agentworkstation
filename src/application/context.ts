export class ContextBuilder {
  build(systemInstructions: string[], evidence: string[], userMessage: string): string {
    return [...systemInstructions, '---', ...evidence, '---', userMessage].join('\n');
  }
}


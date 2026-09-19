import type { IntelligencePort, ModelExecutionContext, ModelRequest, ModelResponse } from '../../domain/intelligence';

export class DeterministicMemoryExtractionAdapter implements IntelligencePort {
  async execute(request: ModelRequest, _context: ModelExecutionContext, signal: AbortSignal): Promise<ModelResponse> {
    signal.throwIfAborted();
    const answer = [...request.messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';
    const field = request.messages.find((message) => message.role === 'system')?.content
      .match(/Memory field:\s*([^\n]+)/)?.[1]?.trim() ?? 'unknown';
    const urls = answer.match(/https?:\/\/[^\s,]+/gi) ?? [];
    let value: unknown = { text: answer };
    if (field.toLowerCase().includes('sources')) {
      value = urls.length > 0
        ? urls.map((identifier) => ({
          type: /linkedin\.com/i.test(identifier) ? 'linkedin' : /github\.com/i.test(identifier) ? 'github' : 'url',
          identifier,
        }))
        : [{ type: /github/i.test(answer) ? 'github' : /linkedin/i.test(answer) ? 'linkedin' : 'description', identifier: answer }];
    } else if (field.toLowerCase().includes('target')) {
      value = { type: urls.length > 0 ? 'url' : 'description', identifier: urls[0] ?? answer };
    } else if (field.toLowerCase().includes('socialaccount')) {
      value = { type: 'linkedin', identifier: urls[0] ?? answer };
    }
    return { type: 'text', content: JSON.stringify({ value, confidence: urls.length > 0 ? 0.95 : 0.65 }) };
  }
}

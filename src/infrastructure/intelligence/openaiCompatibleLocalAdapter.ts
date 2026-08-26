import type { IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';

export class OpenAICompatibleLocalAdapter implements IntelligencePort {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async execute(request: ModelRequest, context: { modelId: string; executionMode: 'local_only' }, signal: AbortSignal): Promise<ModelResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: context.modelId, messages: request.messages, tools: request.tools }),
      signal,
    });
    if (!response.ok) return { type: 'error', error: `HTTP ${response.status}` };
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    return { type: 'text', content };
  }
}

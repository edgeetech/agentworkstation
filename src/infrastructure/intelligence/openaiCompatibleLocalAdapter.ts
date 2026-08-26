import type { IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';
import type { NetworkGateway } from '@application/ports/NetworkGateway';

export class OpenAICompatibleLocalAdapter implements IntelligencePort {
  constructor(
    private readonly baseUrl: string,
    private readonly networkGateway: NetworkGateway,
  ) {}

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: 'local_only' },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (context.executionMode === 'local_only') {
      const url = new URL(`${this.baseUrl}/v1/chat/completions`);
      const hostname = url.hostname;
      if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
        throw new Error('External network blocked: local_only policy');
      }
    }
    const tools = request.tools?.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: { type: 'object', properties: {} } },
    }));
    const resp = await this.networkGateway.send(
      {
        url: `${this.baseUrl}/v1/chat/completions`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: context.modelId, messages: request.messages, ...(tools ? { tools } : {}) }),
        purpose: 'model-inference',
        destinationClass: 'local',
      },
      signal,
    );
    if (resp.status < 200 || resp.status >= 300) {
      return { type: 'error', error: `HTTP ${resp.status}` };
    }
    const json = JSON.parse(resp.body) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = json.choices?.[0]?.message;
    if (message?.tool_calls?.[0]?.function) {
      const fn = message.tool_calls[0].function;
      const toolName = fn.name ?? '';
      let input: unknown = {};
      try { input = JSON.parse(fn.arguments ?? '{}'); } catch { /* use empty */ }
      return { type: 'tool_call', call: { toolName, input } };
    }
    return { type: 'text', content: message?.content ?? '' };
  }
}

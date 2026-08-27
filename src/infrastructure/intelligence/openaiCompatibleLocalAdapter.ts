import type { IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';
import type { NetworkGateway } from '@application/ports/NetworkGateway';

export class OpenAICompatibleLocalAdapter implements IntelligencePort {
  private readonly endpointUrl: string;

  constructor(
    baseUrl: string,
    private readonly networkGateway: NetworkGateway,
  ) {
    this.endpointUrl = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  }

  async execute(
    request: ModelRequest,
    context: { modelId: string; executionMode: 'local_only' },
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    const tools = request.tools?.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const messages = request.messages.map((message) => {
      if (message.role === 'assistant' && message.toolCalls) {
        return {
          role: 'assistant' as const,
          content: message.content,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.toolName, arguments: JSON.stringify(call.input) },
          })),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool' as const,
          content: message.content,
          tool_call_id: message.toolCallId,
          name: message.toolName,
        };
      }
      return message;
    });
    const resp = await this.networkGateway.send(
      {
        url: this.endpointUrl,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: context.modelId, messages, ...(tools ? { tools } : {}) }),
        purpose: 'model-inference',
        executionMode: context.executionMode,
      },
      signal,
    );
    if (resp.status < 200 || resp.status >= 300) {
      let detail = resp.body.trim();
      try {
        const errorBody = JSON.parse(resp.body) as { error?: { message?: unknown } | string };
        detail = typeof errorBody.error === 'string'
          ? errorBody.error
          : typeof errorBody.error?.message === 'string'
            ? errorBody.error.message
            : detail;
      } catch {
        // Preserve the bounded raw response when a compatible endpoint returns non-JSON.
      }
      return { type: 'error', error: `HTTP ${resp.status}${detail ? `: ${detail.slice(0, 500)}` : ''}` };
    }
    const json = JSON.parse(resp.body) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = json.choices?.[0]?.message;
    if (message?.tool_calls?.[0]?.function) {
      const fn = message.tool_calls[0].function;
      const id = message.tool_calls[0].id;
      const toolName = fn.name ?? '';
      if (!id || !toolName) return { type: 'error', error: 'Malformed tool call response' };
      let input: unknown;
      try {
        input = JSON.parse(fn.arguments ?? '{}');
      } catch {
        return { type: 'error', error: `Invalid tool arguments for ${toolName}` };
      }
      return { type: 'tool_call', call: { id, toolName, input } };
    }
    return { type: 'text', content: message?.content ?? '' };
  }
}

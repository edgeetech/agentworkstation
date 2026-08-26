import type { IntelligencePort, ModelRequest, ModelResponse } from '@domain/intelligence';

export class MockIntelligenceAdapter implements IntelligencePort {
  constructor(private readonly responses: ModelResponse[]) {}

  async execute(_request: ModelRequest, _context: { modelId: string; executionMode: 'local_only' }, _signal: AbortSignal): Promise<ModelResponse> {
    const next = this.responses.shift();
    if (!next) return { type: 'text', content: '' };
    return next;
  }
}


import { describe, expect, it, vi } from 'vitest';
import { AdaptiveRoutingIntelligenceAdapter } from '../../src/application/intelligenceRouting';
import type { IntelligencePort, ModelResponse } from '../../src/domain/intelligence';

const candidate = (
  id: string,
  location: 'local' | 'external',
  execute: IntelligencePort['execute'],
) => ({ id, label: id, location, modelId: `${id}-model`, intelligence: { execute } });

const request = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('adaptive intelligence routing', () => {
  it('enforces local only without invoking the external candidate', async () => {
    const local = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'local' }));
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'local_only', candidate('ollama', 'local', local), candidate('codex', 'external', external),
    );
    await expect(router.execute(request, { modelId: 'ignored', executionMode: 'local_only', taskKind: 'audit' }, new AbortController().signal))
      .resolves.toEqual({ type: 'text', content: 'local' });
    expect(external).not.toHaveBeenCalled();
    expect(router.getLastDecision()).toMatchObject({ providerId: 'ollama', location: 'local', fallback: false });
  });

  it('uses an explicitly permitted external fallback after local failure', async () => {
    const local = vi.fn(async () => { throw new Error('offline'); });
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'local_first', candidate('ollama', 'local', local), candidate('copilot', 'external', external),
    );
    await expect(router.execute(request, { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'chat' }, new AbortController().signal))
      .resolves.toEqual({ type: 'text', content: 'cloud' });
    expect(router.getLastDecision()).toMatchObject({ providerId: 'copilot', location: 'external', fallback: true });
  });

  it('routes audit and proposal reasoning externally while keeping chat local', async () => {
    const local = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'local' }));
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'adaptive', candidate('ollama', 'local', local), candidate('codex', 'external', external),
    );
    await router.execute(request, { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'chat' }, new AbortController().signal);
    expect(router.getLastDecision()).toMatchObject({ providerId: 'ollama' });
    await router.execute(request, { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'audit' }, new AbortController().signal);
    expect(router.getLastDecision()).toMatchObject({ providerId: 'codex' });
  });

  it('does not fall back after cancellation', async () => {
    const controller = new AbortController();
    const local = vi.fn(async () => { controller.abort(); throw new Error('cancelled'); });
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'local_first', candidate('ollama', 'local', local), candidate('codex', 'external', external),
    );
    await expect(router.execute(request, { modelId: 'ignored', executionMode: 'provider_allowed' }, controller.signal))
      .rejects.toThrow('cancelled');
    expect(external).not.toHaveBeenCalled();
  });

  it('falls back when the preferred route attempt times out', async () => {
    const local = vi.fn(async (_request, _context, signal: AbortSignal): Promise<ModelResponse> =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'local_first', candidate('ollama', 'local', local), candidate('codex', 'external', external),
      { localMs: 5, externalMs: 50 },
    );
    await expect(router.execute(request, { modelId: 'ignored', executionMode: 'provider_allowed' }, new AbortController().signal))
      .resolves.toEqual({ type: 'text', content: 'cloud' });
    expect(router.getLastDecision()).toMatchObject({ providerId: 'codex', fallback: true });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AdaptiveRoutingIntelligenceAdapter, promptNeedsStrongerReasoning } from '../../src/application/intelligenceRouting';
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

  it('returns response and its routing decision as one atomic extraction result', async () => {
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'extracted' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'adaptive', null, candidate('codex', 'external', external),
    );

    await expect(router.executeWithRouting(
      request,
      { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'onboarding_extraction' },
      new AbortController().signal,
    )).resolves.toEqual({
      response: { type: 'text', content: 'extracted' },
      route: expect.objectContaining({ providerId: 'codex', location: 'external', modelId: 'codex-model' }),
    });
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

  it('classifies complex prompts before routing chat automatically', async () => {
    expect(promptNeedsStrongerReasoning(request)).toBe(false);
    const complexRequest = {
      messages: [{
        role: 'user' as const,
        content: 'Review this architecture migration and compare the security tradeoffs before proposing an implementation plan.',
      }],
    };
    expect(promptNeedsStrongerReasoning(complexRequest)).toBe(true);

    const local = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'local' }));
    const external = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'cloud' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'adaptive', candidate('ollama', 'local', local), candidate('claude', 'external', external),
    );
    await router.execute(complexRequest, { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'chat' }, new AbortController().signal);
    expect(router.getLastDecision()).toMatchObject({ providerId: 'claude', location: 'external' });
    expect(local).not.toHaveBeenCalled();
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

  it('falls back from a quota-limited cloud model to the next allowed provider', async () => {
    const attempts: Array<{ status: string; modelId: string }> = [];
    const cloud = vi.fn(async (): Promise<ModelResponse> => ({ type: 'error', error: 'HTTP 429: session usage limit reached' }));
    const local = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'local fallback' }));
    const provider = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'provider fallback' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'adaptive',
      [candidate('ollama', 'local', local)],
      [candidate('ollama-cloud', 'external', cloud), candidate('codex', 'external', provider)],
      { localMs: 50, externalMs: 50 },
      (attempt) => attempts.push({ status: attempt.status, modelId: attempt.candidate.modelId }),
    );
    const complexRequest = { messages: [{ role: 'user' as const, content: 'Review and analyze this architecture migration.' }] };
    await expect(router.execute(complexRequest, { modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'chat' }, new AbortController().signal))
      .resolves.toEqual({ type: 'text', content: 'provider fallback' });
    expect(local).not.toHaveBeenCalled();
    expect(attempts).toEqual([
      { status: 'limited', modelId: 'ollama-cloud-model' },
      { status: 'available', modelId: 'codex-model' },
    ]);
  });

  it('honors the complete allowed provider priority before local fallback', async () => {
    const attempts: string[] = [];
    const failing = (id: string): IntelligencePort['execute'] => vi.fn(async () => {
      attempts.push(id);
      throw new Error(`${id} unavailable`);
    });
    const claude = vi.fn(async (): Promise<ModelResponse> => {
      attempts.push('claude');
      return { type: 'text', content: 'claude answer' };
    });
    const local = vi.fn(async (): Promise<ModelResponse> => ({ type: 'text', content: 'local' }));
    const router = new AdaptiveRoutingIntelligenceAdapter(
      'adaptive', candidate('ollama', 'local', local), [
        candidate('codex', 'external', failing('codex')),
        candidate('copilot', 'external', failing('copilot')),
        candidate('claude', 'external', claude),
      ],
    );
    const complexRequest = { messages: [{ role: 'user' as const, content: 'Review and analyze this architecture migration.' }] };

    await expect(router.execute(complexRequest, {
      modelId: 'ignored', executionMode: 'provider_allowed', taskKind: 'chat',
    }, new AbortController().signal)).resolves.toEqual({ type: 'text', content: 'claude answer' });
    expect(attempts).toEqual(['codex', 'copilot', 'claude']);
    expect(local).not.toHaveBeenCalled();
    expect(router.getLastDecision()).toMatchObject({ providerId: 'claude', fallback: true });
  });
});

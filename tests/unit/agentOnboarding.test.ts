import { describe, expect, it } from 'vitest';
import { AgentOnboardingService, inferJustInTimeIntent } from '../../src/application/onboarding/AgentOnboardingService';
import type { IntelligencePort, ModelResponse, RoutingDecision } from '../../src/domain/intelligence';
import type { AgentMemoryEntry, AgentMemoryStore, OnboardingQuestion } from '../../src/domain/onboarding';
import { looksLikeRequestNotAnswer, renderOnboardingStep } from '../../src/application/onboarding/AgentOnboardingService';

class MemoryStore implements AgentMemoryStore {
  readonly entries = new Map<string, AgentMemoryEntry>();
  readonly activeIntents = new Map<string, 'publish' | 'linkedin'>();
  async getAgentMemory(agentId: string): Promise<AgentMemoryEntry[]> {
    return [...this.entries.values()].filter((entry) => entry.agentId === agentId);
  }
  async getMemoryEntry(agentId: string, fieldKey: string): Promise<AgentMemoryEntry | null> {
    return this.entries.get(`${agentId}:${fieldKey}`) ?? null;
  }
  async saveMemoryEntry(entry: AgentMemoryEntry): Promise<void> {
    this.entries.set(`${entry.agentId}:${entry.fieldKey}`, entry);
  }
  async getActiveOnboardingIntent(agentId: string): Promise<'publish' | 'linkedin' | null> {
    return this.activeIntents.get(agentId) ?? null;
  }
  async setActiveOnboardingIntent(agentId: string, intent: 'initial' | 'publish' | 'linkedin' | null): Promise<void> {
    if (intent === 'publish' || intent === 'linkedin') this.activeIntents.set(agentId, intent);
    else this.activeIntents.delete(agentId);
  }
}

function fakeIntelligence(...responses: ModelResponse[]): IntelligencePort {
  return { async execute() { return responses.shift() ?? { type: 'error', error: 'No fake response' }; } };
}

const questions: OnboardingQuestion[] = [
  {
    id: 'source', prompt: 'Source?', memoryKey: 'career.sources', intent: 'initial', critical: true,
    extractionHint: 'Extract sources.',
  },
  {
    id: 'preference', prompt: 'Language?', memoryKey: 'career.language', intent: 'initial', critical: false,
    extractionHint: 'Extract a language.',
  },
  {
    id: 'publish', prompt: 'Publish where?', memoryKey: 'career.publishTarget', intent: 'publish', critical: true,
    extractionHint: 'Extract a target.',
  },
];

function service(
  store: MemoryStore,
  intelligence: IntelligencePort,
  fallbackIntelligence?: IntelligencePort,
): AgentOnboardingService {
  return new AgentOnboardingService(
    { get: (id) => ({ id, onboarding: questions }) },
    store,
    intelligence,
    { modelId: 'deterministic-test', executionMode: 'local_only' },
    () => new Date('2026-09-11T10:00:00.000Z'),
    fallbackIntelligence,
  );
}

describe('AgentOnboardingService', () => {
  it.each([
    ['Bunu publish etmek istiyorum', 'publish'],
    ['Makaleyi siteye koy', 'publish'],
    ['LinkedIn üzerinde paylaş', 'linkedin'],
    ['LinkedIn hesabımı bağla', 'linkedin'],
  ] as const)('detects explicit just-in-time action intent in %s', (message, intent) => {
    expect(inferJustInTimeIntent(message)).toBe(intent);
  });

  it.each([
    'LinkedIn profilimi incele',
    'LinkedIn profilimde hangi deneyimler var?',
    'GitHub repository analizini yap',
    'Analyze the repository publishing workflow',
    'Repository deploy stratejisini değerlendir',
    'Bu repo hakkında ne düşünüyorsun?',
    'Web site mimarisini incele',
    'Sosyal medya stratejisini değerlendir',
  ])('does not infer a side-effect intent from inspection or analysis: %s', (message) => {
    expect(inferJustInTimeIntent(message)).toBeNull();
  });

  it('asks one question at a time and explicitly confirms critical memory', async () => {
    const store = new MemoryStore();
    const onboarding = service(store, fakeIntelligence(
      { type: 'text', content: '{"value":[{"type":"github","identifier":"asozyurt"}],"confidence":0.96}' },
      { type: 'text', content: '{"value":"tr","confidence":0.9}' },
    ));

    expect(await onboarding.getStep('career')).toMatchObject({ kind: 'question', question: { id: 'source' } });
    const pending = await onboarding.answer('career', 'source', 'GitHub hesabım asozyurt', new AbortController().signal);
    expect(pending).toMatchObject({
      kind: 'confirmation',
      memory: {
        value: [{ type: 'github', identifier: 'asozyurt' }],
        confidence: 0.96,
        confirmationStatus: 'pending',
        provenance: { source: 'user_message', questionId: 'source' },
      },
    });
    expect(await onboarding.confirm('career', 'career.sources', true))
      .toMatchObject({ kind: 'question', question: { id: 'preference' } });
    expect(await onboarding.answer('career', 'preference', 'Türkçe', new AbortController().signal))
      .toEqual({ kind: 'complete', intent: 'initial' });
  });

  it('keeps just-in-time publication setup separate from initial onboarding', async () => {
    const onboarding = service(new MemoryStore(), fakeIntelligence());
    expect(await onboarding.getStep('career', 'publish'))
      .toMatchObject({ kind: 'question', question: { id: 'publish' } });
    expect(await onboarding.getStep('career', 'linkedin')).toEqual({ kind: 'complete', intent: 'linkedin' });
  });

  it('triggers publication setup from conversational intent after initial onboarding', async () => {
    const store = new MemoryStore();
    store.entries.set('career:career.sources', {
      agentId: 'career', fieldKey: 'career.sources', value: [{ type: 'github', identifier: 'asozyurt' }],
      provenance: { source: 'user_message', questionId: 'source', capturedAt: '2026-09-11T10:00:00.000Z' },
      confidence: 1, confirmationStatus: 'confirmed', confirmedAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T10:00:00.000Z',
    });
    store.entries.set('career:career.language', {
      agentId: 'career', fieldKey: 'career.language', value: 'tr',
      provenance: { source: 'user_message', questionId: 'preference', capturedAt: '2026-09-11T10:00:00.000Z' },
      confidence: 1, confirmationStatus: 'confirmed', confirmedAt: '2026-09-11T10:00:00.000Z',
      updatedAt: '2026-09-11T10:00:00.000Z',
    });
    const onboarding = service(store, fakeIntelligence(
      { type: 'text', content: '{"value":{"type":"url","identifier":"https://example.com"},"confidence":0.99}' },
    ));

    const prompt = await onboarding.handleMessage(
      'career', 'Bunu publish etmek istiyorum', new AbortController().signal,
    );
    expect(prompt).toMatchObject({ step: { kind: 'question', question: { id: 'publish' } } });
    expect(store.activeIntents.get('career')).toBe('publish');
    const reply = await onboarding.handleMessage(
      'career', 'https://example.com', new AbortController().signal,
    );
    expect(reply).toMatchObject({ step: { kind: 'confirmation', question: { id: 'publish' } } });
    expect(await store.getMemoryEntry('career', 'career.publishTarget'))
      .toMatchObject({ confirmationStatus: 'pending', value: { identifier: 'https://example.com' } });
  });

  it('never persists OAuth credentials or tokens', async () => {
    const store = new MemoryStore();
    const onboarding = service(store, fakeIntelligence(
      { type: 'text', content: '{"value":{"access_token":"secret-value"},"confidence":1}' },
    ));
    await expect(onboarding.answer('career', 'source', 'profile source', new AbortController().signal))
      .rejects.toThrow('Sensitive field cannot be stored');
    expect(store.entries.size).toBe(0);

    await expect(onboarding.answer(
      'career', 'source', 'access_token=secret-value', new AbortController().signal,
    )).rejects.toThrow('cannot be sent to a model or stored');
  });

  it.each([
    'ghp_abcdefghijklmnopqrstuvwxyz123456',
    'github_pat_11AAabcdefghijklmnopqrstuvwxyz123456',
    'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyA1234567890abcdefghijklmnopqrstuvwxyz',
    'xoxb-123456789012-abcdefghijklmnop',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345',
    '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    'https://user:very-secret-password@example.com/profile',
  ])('blocks a bare credential before any intelligence call: %s', async (secret) => {
    let calls = 0;
    const onboarding = service(new MemoryStore(), {
      async execute() {
        calls += 1;
        return { type: 'text', content: '{"value":[],"confidence":1}' };
      },
    });
    await expect(onboarding.answer('career', 'source', secret, new AbortController().signal))
      .rejects.toThrow('cannot be sent to a model or stored');
    expect(calls).toBe(0);
  });

  it('renders confirmation values as a human-readable summary', async () => {
    const onboarding = service(new MemoryStore(), fakeIntelligence(
      { type: 'text', content: '{"value":[{"type":"github","identifier":"asozyurt"}],"confidence":0.96}' },
    ));
    const step = await onboarding.answer('career', 'source', 'GitHub hesabım asozyurt', new AbortController().signal);
    const message = renderOnboardingStep(step);
    expect(message).toContain('- github: asozyurt');
    expect(message).not.toContain('{"type"');
  });

  it('rejects out-of-order answers', async () => {
    const onboarding = service(new MemoryStore(), fakeIntelligence());
    await expect(onboarding.answer('career', 'preference', 'tr', new AbortController().signal))
      .rejects.toThrow('Only the current onboarding question can be answered');
  });

  it('rejects arbitrary JSON shapes for source fields', async () => {
    const onboarding = service(new MemoryStore(), fakeIntelligence(
      { type: 'text', content: '{"value":{"anything":true},"confidence":0.9}' },
    ));
    await expect(onboarding.answer('career', 'source', 'my source', new AbortController().signal))
      .rejects.toThrow('must be a non-empty source list');
  });

  it('uses deterministic extraction when the configured intelligence route is unavailable', async () => {
    const store = new MemoryStore();
    const unavailable = fakeIntelligence({ type: 'error', error: 'No eligible intelligence connection is configured' });
    const fallback = fakeIntelligence({
      type: 'text',
      content: '{"value":[{"type":"github","identifier":"asozyurt"}],"confidence":0.8}',
    });

    await expect(service(store, unavailable, fallback).answer(
      'career', 'source', 'GitHub hesabım asozyurt', new AbortController().signal,
    )).resolves.toMatchObject({ kind: 'confirmation' });
    expect(await store.getMemoryEntry('career', 'career.sources')).toMatchObject({
      value: [{ type: 'github', identifier: 'asozyurt' }],
      confirmationStatus: 'pending',
    });
  });

  it('falls back when a provider returns an invalid source shape', async () => {
    const store = new MemoryStore();
    const invalidProvider = fakeIntelligence({
      type: 'text', content: '{"value":{"text":"https://asozyurt.com/writing/"},"confidence":0.9}',
    });
    const fallback = fakeIntelligence({
      type: 'text', content: '{"value":[{"type":"url","identifier":"https://asozyurt.com/writing/"}],"confidence":0.8}',
    });

    await expect(service(store, invalidProvider, fallback).answer(
      'career', 'source', 'https://asozyurt.com/writing/', new AbortController().signal,
    )).resolves.toMatchObject({ kind: 'confirmation' });
    expect(await store.getMemoryEntry('career', 'career.sources')).toMatchObject({
      value: [{ type: 'url', identifier: 'https://asozyurt.com/writing/' }],
    });
  });

  it('recovers Blogger source URLs from the user message when a provider returns an empty list', async () => {
    const store = new MemoryStore();
    const question: OnboardingQuestion = {
      id: 'choose-writing-sources',
      prompt: 'Writing sources?',
      memoryKey: 'blogger.voiceSources',
      intent: 'initial',
      critical: true,
      extractionHint: 'Extract sources.',
    };
    const onboarding = new AgentOnboardingService(
      { get: (id) => ({ id, onboarding: [question] }) },
      store,
      fakeIntelligence({ type: 'text', content: '{"value":[],"confidence":0.9}' }),
      { modelId: 'provider-selected', executionMode: 'provider_allowed' },
      () => new Date('2026-09-11T10:00:00.000Z'),
    );

    await expect(onboarding.handleMessage(
      'blogger',
      'yayinladigim yazilarim surada: https://asozyurt.com/writing/ yazi tarzimi buradan anlayabilirsin.',
      new AbortController().signal,
    )).resolves.toMatchObject({ step: { kind: 'confirmation' } });
    expect(await store.getMemoryEntry('blogger', 'blogger.voiceSources')).toMatchObject({
      value: [{ type: 'url', identifier: 'https://asozyurt.com/writing/' }],
      confirmationStatus: 'pending',
    });
  });

  it('asks for an optional additional source after the first source is confirmed', async () => {
    const store = new MemoryStore();
    const sourceQuestion: OnboardingQuestion = {
      id: 'choose-career-sources', prompt: 'Sources?', memoryKey: 'career.sources',
      intent: 'initial', critical: true, required: true, extractionHint: 'Extract sources.',
    };
    const additionalQuestion: OnboardingQuestion = {
      id: 'choose-additional-career-sources', prompt: 'Anything else?', memoryKey: 'career.additionalSources',
      intent: 'initial', critical: true, optional: true, extractionHint: 'Extract additional sources.',
    };
    const onboarding = new AgentOnboardingService(
      { get: (id) => ({ id, onboarding: [sourceQuestion, additionalQuestion] }) },
      store,
      fakeIntelligence(
        { type: 'text', content: '{"value":[{"type":"github","identifier":"https://github.com/asozyurt"}],"confidence":0.9}' },
        { type: 'text', content: '{"value":[{"type":"linkedin","identifier":"https://linkedin.com/in/asozyurt"}],"confidence":0.9}' },
      ),
      { modelId: 'provider-selected', executionMode: 'provider_allowed' },
      () => new Date('2026-09-11T10:00:00.000Z'),
    );

    await onboarding.handleMessage('career', 'https://github.com/asozyurt', new AbortController().signal);
    const additional = await onboarding.handleMessage('career', 'evet', new AbortController().signal);
    expect(additional).toMatchObject({ step: { kind: 'question', question: { id: additionalQuestion.id } } });
    await onboarding.handleMessage('career', 'https://linkedin.com/in/asozyurt', new AbortController().signal);
    const complete = await onboarding.handleMessage('career', 'evet', new AbortController().signal);
    expect(complete).toMatchObject({ step: { kind: 'complete', intent: 'initial' } });
    expect(await store.getMemoryEntry('career', 'career.additionalSources')).toMatchObject({
      value: [{ type: 'linkedin', identifier: 'https://linkedin.com/in/asozyurt' }],
      confirmationStatus: 'confirmed',
    });
  });

  it('allows an optional additional-source question to be skipped', async () => {
    const store = new MemoryStore();
    const optionalQuestion: OnboardingQuestion = {
      id: 'choose-additional-career-sources', prompt: 'Anything else?', memoryKey: 'career.additionalSources',
      intent: 'initial', critical: true, optional: true, extractionHint: 'Extract additional sources.',
    };
    const onboarding = new AgentOnboardingService(
      { get: (id) => ({ id, onboarding: [optionalQuestion] }) },
      store,
      fakeIntelligence(),
      { modelId: 'provider-selected', executionMode: 'provider_allowed' },
      () => new Date('2026-09-11T10:00:00.000Z'),
    );

    const complete = await onboarding.handleMessage('career', 'hayır', new AbortController().signal);
    expect(complete).toMatchObject({ step: { kind: 'complete', intent: 'initial' } });
    expect(await store.getMemoryEntry('career', 'career.additionalSources')).toMatchObject({
      value: [], confirmationStatus: 'confirmed',
    });
  });

  it('returns the exact routing decision used for model-backed extraction', async () => {
    const route: RoutingDecision = {
      policy: 'adaptive', location: 'external', providerId: 'codex', providerLabel: 'Codex',
      modelId: 'gpt-frontier', reason: 'Selected for onboarding extraction.', fallback: false,
    };
    const routed = {
      async execute(): Promise<ModelResponse> {
        throw new Error('executeWithRouting should provide the atomic result');
      },
      async executeWithRouting() {
        return {
          response: {
            type: 'text' as const,
            content: '{"value":[{"type":"github","identifier":"asozyurt"}],"confidence":0.98}',
          },
          route,
        };
      },
    };

    const reply = await service(new MemoryStore(), routed).handleMessage(
      'career', 'GitHub hesabım asozyurt', new AbortController().signal,
    );

    expect(reply?.route).toEqual(route);
    expect(reply?.route?.location).not.toBe('simulated');
  });

  it('lets the user skip a setup question and moves to the next one', async () => {
    const store = new MemoryStore();
    const reply = await service(store, fakeIntelligence()).handleMessage('career', 'Skip for now', new AbortController().signal);
    expect(reply?.step).toMatchObject({ kind: 'question', question: { id: 'preference' } });
    expect(await store.getMemoryEntry('career', 'career.sources')).toMatchObject({ value: [], confirmationStatus: 'confirmed' });
    const done = await service(store, fakeIntelligence()).handleMessage('career', 'atla', new AbortController().signal);
    expect(done?.step).toEqual({ kind: 'complete', intent: 'initial' });
    expect(await store.getMemoryEntry('career', 'career.language')).toMatchObject({ value: null });
  });

  it('passes real questions and tasks to the agent instead of storing them as setup answers', async () => {
    const store = new MemoryStore();
    const onboarding = service(store, fakeIntelligence());
    for (const message of [
      'Which of my projects best shows leadership?',
      'Review my latest pull requests and summarise them',
      'Bu hafta neler yaptım, özetle',
    ]) {
      await expect(onboarding.handleMessage('career', message, new AbortController().signal)).resolves.toBeNull();
    }
    expect(await store.getAgentMemory('career')).toEqual([]);
    expect(looksLikeRequestNotAnswer('My GitHub profile')).toBe(false);
    expect(looksLikeRequestNotAnswer('https://github.com/asozyurt?tab=repositories')).toBe(false);
    expect(looksLikeRequestNotAnswer('Can you use C:\\cv\\resume.docx?')).toBe(false);
    expect(looksLikeRequestNotAnswer('I will describe it myself')).toBe(false);
  });
});

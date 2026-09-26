import type {
  IntelligencePort,
  ModelExecutionContext,
  ModelRequest,
  ModelResponse,
  RoutingDecision,
} from '../../domain/intelligence';
import type {
  AgentMemoryEntry,
  AgentMemoryStore,
  ExtractedMemoryValue,
  OnboardingIntent,
  OnboardingQuestion,
  OnboardingStep,
} from '../../domain/onboarding';

export type OnboardingAgentDefinition = {
  id: string;
  onboarding: OnboardingQuestion[];
};

export interface OnboardingAgentCatalog {
  get(id: string): OnboardingAgentDefinition;
}

export type OnboardingReply = { step: OnboardingStep; message: string; route?: RoutingDecision };

type RoutingAwareIntelligencePort = IntelligencePort & {
  executeWithRouting(
    request: ModelRequest,
    context: ModelExecutionContext,
    signal: AbortSignal,
  ): Promise<{ response: ModelResponse; route: RoutingDecision }>;
};

function supportsAtomicRouting(intelligence: IntelligencePort): intelligence is RoutingAwareIntelligencePort {
  return 'executeWithRouting' in intelligence
    && typeof (intelligence as Partial<RoutingAwareIntelligencePort>).executeWithRouting === 'function';
}

export function inferJustInTimeIntent(message: string): OnboardingIntent | null {
  const actionWord = /\b(?:publish|deploy|share|post|connect)(?:ing|ed)?\b|paylaş|paylas|gönder|gonder|bağla|bagla|yayınla|yayinla|yayımla|yayimla/i;
  const inspectionRequest = /\b(?:analy[sz]e|inspect|review|explain|strategy|workflow)\b|incele|analiz|değerlendir|degerlendir/i;
  const explicitCommitment = /\b(?:i\s+(?:want|intend|need)\s+to|please|now|then)\b|istiyorum|lütfen|lutfen|şimdi|simdi|sonra/i;
  const actionCommand = new RegExp(`^(?:please\\s+|lütfen\\s+|lutfen\\s+)?(?:${actionWord.source})|(?:${actionWord.source})(?:\\s+(?:it|this|bunu|şunu|sunu))?[.!]?$`, 'i');
  if (inspectionRequest.test(message) && !explicitCommitment.test(message) && !actionCommand.test(message.trim())) {
    return null;
  }
  const linkedinDestination = /\blinked\s*in\b|sosyal\s+(?:medya|ağ)|social\s+(?:media|network)/i;
  const linkedinAction = /\b(?:share|post|connect)(?:ing|ed)?\b|paylaş|paylas|gönder|gonder|bağla|bagla|yayınla|yayinla|yayımla|yayimla/i;
  if (linkedinDestination.test(message) && linkedinAction.test(message)) return 'linkedin';
  if (/\b(?:publish|deploy)(?:ing|ed)?\b|yayımla|yayimla|yayınla|yayinla|yayına\s+al|yayina\s+al|canlıya\s+al|canliya\s+al|siteye\s+(?:koy|ekle|yükle|yukle|gönder|gonder)/i.test(message)) {
    return 'publish';
  }
  return null;
}

const skipCommand = /^(?:skip|skip for now|not now|later|atla|şimdilik atla|simdilik atla|geç|gec|sonra)[.!]?$/i;

/**
 * True when a message reads as a task or question for the agent rather than an
 * answer to the pending setup question. Such messages go to the agent instead of
 * being stored as memory, so setup never blocks real work.
 */
export function looksLikeRequestNotAnswer(message: string): boolean {
  const text = message.trim();
  if (text.length < 12) return false;
  if (/https?:\/\/|www\.|[a-z]:[\\/]|\/[\w.-]+\/|\.(?:pdf|docx?|md|txt|csv|json)\b/i.test(text)) return false;
  if (/\?\s*$/.test(text)) return true;
  // Turkish puts the verb last: "Bu hafta neler yaptım, özetle".
  if (/(?:^|[\s,])(?:özetle|ozetle|incele|yaz|anlat|açıkla|acikla|listele|göster|goster|hazırla|hazirla|karşılaştır|karsilastir|kontrol et|bul)[.!]?$/i.test(text)) return true;
  return /^(?:can|could|would|will|please|what|how|why|who|when|where|which|tell|explain|help|write|draft|review|summari[sz]e|analy[sz]e|compare|list|show|find|check|build|prepare|ne|neler|nasıl|nasil|neden|niye|kim|hangi|lütfen|lutfen|yaz|anlat|açıkla|acikla|incele|özetle|ozetle|karşılaştır|karsilastir|listele|göster|goster|bul|kontrol|hazırla|hazirla)(?=\s|$)/i.test(text);
}

export function renderOnboardingStep(step: OnboardingStep): string {
  if (step.kind === 'question') return step.question.prompt;
  if (step.kind === 'confirmation') {
    const describe = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map((item) => `- ${describe(item)}`).join('\n');
      if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        if (typeof item.identifier === 'string') {
          const type = typeof item.type === 'string' ? `${item.type}: ` : '';
          return `${type}${item.identifier}`;
        }
        return Object.entries(item).map(([key, nested]) => `${key}: ${describe(nested)}`).join(', ');
      }
      return String(value);
    };
    return `Şunu anladım:\n${describe(step.memory.value)}\n\nDoğru mu? Lütfen evet veya hayır diye yanıtla.`;
  }
  return step.intent === 'initial' ? 'Başlangıç bilgilerin hazır.' : 'Bu işlem için gereken bilgiler hazır.';
}

const forbiddenKey = /(?:^|[_-])(access|refresh|id)?[_-]?token$|secret|password|oauth[_-]?code|authorization/i;
const secretPatterns = [
  /(?:access_token|refresh_token|client_secret|api[_-]?key|oauth[_-]?code|authorization|password)\s*[:=]\s*\S+/i,
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{12,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{30,})\b/,
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
  /(?:https?|ssh):\/\/[^\s/:]+:[^\s/@]+@/i,
  /\b[^\s:@]+@[^\s:]+:[^\s]{8,}\b/,
];

function assertSafeMemory(value: unknown, path = 'value'): void {
  if (typeof value === 'string') {
    if (secretPatterns.some((pattern) => pattern.test(value))) {
      throw new Error('Credentials, private keys, and tokens cannot be sent to a model or stored in agent memory');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeMemory(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw new Error(`Sensitive field cannot be stored in agent memory: ${path}.${key}`);
    assertSafeMemory(nested, `${path}.${key}`);
  }
}

function parseExtraction(content: string): ExtractedMemoryValue {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const parsed = JSON.parse((fenced ?? content).trim()) as { value?: unknown; confidence?: unknown };
  if (!Object.prototype.hasOwnProperty.call(parsed, 'value')) throw new Error('Memory extraction did not return a value');
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error('Memory extraction confidence must be between 0 and 1');
  }
  assertSafeMemory(parsed.value);
  return { value: parsed.value, confidence: parsed.confidence };
}

function validateExtractedValue(question: OnboardingQuestion, value: unknown): void {
  const isObjectWithStrings = (candidate: unknown): candidate is Record<string, string> =>
    Boolean(candidate) && typeof candidate === 'object'
      && typeof (candidate as Record<string, unknown>).type === 'string'
      && typeof (candidate as Record<string, unknown>).identifier === 'string'
      && ((candidate as Record<string, string>).identifier.trim().length > 0);
  const key = question.memoryKey.toLowerCase();
  if (key.includes('sources')) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isObjectWithStrings)) {
      throw new Error(`Memory extraction for ${question.memoryKey} must be a non-empty source list`);
    }
    return;
  }
  if (key.includes('target') || key.includes('socialaccount')) {
    if (!isObjectWithStrings(value)) {
      throw new Error(`Memory extraction for ${question.memoryKey} must contain type and identifier`);
    }
  }
}

function recoverSourceList(question: OnboardingQuestion, answer: string): ExtractedMemoryValue | null {
  if (!question.memoryKey.toLowerCase().includes('sources')) return null;
  const urls = (answer.match(/https?:\/\/[^\s<>"']+/gi) ?? [])
    .map((identifier) => identifier.replace(/[),.;!?]+$/u, ''))
    .filter(Boolean);
  if (urls.length === 0) return null;
  const value = urls.map((identifier) => ({
    type: /linkedin\.com/i.test(identifier) ? 'linkedin' : /github\.com/i.test(identifier) ? 'github' : 'url',
    identifier,
  }));
  assertSafeMemory(value);
  return { value, confidence: 0.95 };
}

export class AgentOnboardingService {
  constructor(
    private readonly catalog: OnboardingAgentCatalog,
    private readonly memory: AgentMemoryStore,
    private readonly intelligence: IntelligencePort,
    private readonly executionContext: ModelExecutionContext,
    private readonly now: () => Date = () => new Date(),
    private readonly fallbackIntelligence?: IntelligencePort,
  ) {}

  async getStep(agentId: string, intent: OnboardingIntent = 'initial'): Promise<OnboardingStep> {
    const agent = this.catalog.get(agentId);
    const questions = agent.onboarding.filter((question) => question.intent === intent);
    for (const question of questions) {
      const entry = await this.memory.getMemoryEntry(agentId, question.memoryKey);
      if (!entry || entry.confirmationStatus === 'rejected') return { kind: 'question', question };
      if (entry.confirmationStatus === 'pending') return { kind: 'confirmation', question, memory: entry };
    }
    return { kind: 'complete', intent };
  }

  async handleMessage(agentId: string, message: string, signal: AbortSignal): Promise<OnboardingReply | null> {
    let step = await this.getStep(agentId, 'initial');
    if (step.kind === 'complete') {
      const activeIntent = await this.memory.getActiveOnboardingIntent(agentId);
      if (!activeIntent) {
        const justInTimeIntent = inferJustInTimeIntent(message);
        if (!justInTimeIntent) return null;
        step = await this.getStep(agentId, justInTimeIntent);
        if (step.kind === 'complete') return null;
        await this.memory.setActiveOnboardingIntent(agentId, justInTimeIntent);
        return { step, message: renderOnboardingStep(step) };
      }
      step = await this.getStep(agentId, activeIntent);
      if (step.kind === 'complete') {
        await this.memory.setActiveOnboardingIntent(agentId, null);
        return null;
      }
    }

    let next: OnboardingStep;
    let route: RoutingDecision | undefined;
    if (step.kind === 'question' && looksLikeRequestNotAnswer(message)) return null;
    if (step.kind === 'question' && skipCommand.test(message.trim())) {
      const timestamp = this.now().toISOString();
      await this.memory.saveMemoryEntry({
        agentId,
        fieldKey: step.question.memoryKey,
        value: step.question.memoryKey.toLowerCase().includes('sources') ? [] : null,
        provenance: { source: 'user_message', questionId: step.question.id, capturedAt: timestamp },
        confidence: 1,
        confirmationStatus: 'confirmed',
        confirmedAt: timestamp,
        updatedAt: timestamp,
      });
      next = await this.getStep(agentId, step.question.intent);
      if (next.kind === 'complete' && next.intent !== 'initial') await this.memory.setActiveOnboardingIntent(agentId, null);
      return { step: next, message: renderOnboardingStep(next) };
    }
    if (step.kind === 'confirmation') {
      if (/^(?:evet|yes|doğru|dogru|onaylıyorum|onayliyorum|ok|okay)$/i.test(message.trim())) {
        next = await this.confirm(agentId, step.memory.fieldKey, true);
      } else if (/^(?:hayır|hayir|no|yanlış|yanlis|reddet)$/i.test(message.trim())) {
        next = await this.confirm(agentId, step.memory.fieldKey, false);
      } else {
        return { step, message: renderOnboardingStep(step) };
      }
    } else if (step.question.optional && /^(?:hayır|hayir|no|şimdilik yeterli|simdilik yeterli|yeterli)$/i.test(message.trim())) {
      const timestamp = this.now().toISOString();
      await this.memory.saveMemoryEntry({
        agentId,
        fieldKey: step.question.memoryKey,
        value: [],
        provenance: { source: 'user_message', questionId: step.question.id, capturedAt: timestamp },
        confidence: 1,
        confirmationStatus: 'confirmed',
        confirmedAt: timestamp,
        updatedAt: timestamp,
      });
      next = await this.getStep(agentId, step.question.intent);
    } else {
      const answered = await this.answerWithRouting(agentId, step.question.id, message, signal);
      next = answered.step;
      route = answered.route;
    }
    if (next.kind === 'complete' && next.intent !== 'initial') {
      await this.memory.setActiveOnboardingIntent(agentId, null);
    }
    return { step: next, message: renderOnboardingStep(next), ...(route ? { route } : {}) };
  }

  async answer(agentId: string, questionId: string, rawAnswer: string, signal: AbortSignal): Promise<OnboardingStep> {
    return (await this.answerWithRouting(agentId, questionId, rawAnswer, signal)).step;
  }

  private async answerWithRouting(
    agentId: string,
    questionId: string,
    rawAnswer: string,
    signal: AbortSignal,
  ): Promise<{ step: OnboardingStep; route?: RoutingDecision }> {
    const answer = rawAnswer.trim();
    if (!answer) throw new Error('Answer cannot be empty');
    assertSafeMemory(answer);
    const agent = this.catalog.get(agentId);
    const question = agent.onboarding.find((candidate) => candidate.id === questionId);
    if (!question) throw new Error(`Unknown onboarding question: ${questionId}`);

    const current = await this.getStep(agentId, question.intent);
    if (current.kind !== 'question' || current.question.id !== questionId) {
      throw new Error('Only the current onboarding question can be answered');
    }

    const request: ModelRequest = {
      messages: [
        {
          role: 'system',
          content: [
            'Extract durable, non-secret agent memory from the user answer.',
            'Return JSON only: {"value": <JSON-compatible value>, "confidence": <number 0..1>}.',
            'Never return OAuth codes, access tokens, refresh tokens, client secrets, passwords, or authorization headers.',
            `Memory field: ${question.memoryKey}`,
            `Extraction guidance: ${question.extractionHint}`,
          ].join('\n'),
        },
        { role: 'user', content: answer },
      ],
      tools: [],
    };
    const directlyRecovered = recoverSourceList(question, answer);
    let execution: { response: ModelResponse; route?: RoutingDecision };
    let extracted: ExtractedMemoryValue;
    if (directlyRecovered) {
      extracted = directlyRecovered;
      execution = { response: { type: 'text', content: JSON.stringify(directlyRecovered) } };
    } else {
      execution = await this.executeExtraction(request, signal);
      try {
        const response = execution.response;
        if (response.type !== 'text') throw new Error(response.type === 'error' ? response.error : 'Memory extraction must return text');
        extracted = parseExtraction(response.content);
        validateExtractedValue(question, extracted.value);
      } catch (primaryError) {
        if (!this.fallbackIntelligence || signal.aborted) throw primaryError;
        signal.throwIfAborted();
        const fallbackResponse = await this.fallbackIntelligence.execute(request, this.executionContext, signal);
        if (fallbackResponse.type !== 'text') {
          throw new Error('I could not understand that answer. Please send a link, profile name, or local folder path.');
        }
        try {
          extracted = parseExtraction(fallbackResponse.content);
          validateExtractedValue(question, extracted.value);
          execution = { response: fallbackResponse };
        } catch {
          throw new Error('I could not understand that answer. Please send a link, profile name, or local folder path.');
        }
      }
    }
    const timestamp = this.now().toISOString();
    await this.memory.saveMemoryEntry({
      agentId,
      fieldKey: question.memoryKey,
      value: extracted.value,
      provenance: { source: 'user_message', questionId, capturedAt: timestamp },
      confidence: extracted.confidence,
      confirmationStatus: question.critical ? 'pending' : 'confirmed',
      ...(question.critical ? {} : { confirmedAt: timestamp }),
      updatedAt: timestamp,
    });
    const next = await this.getStep(agentId, question.intent);
    return { step: next, ...(execution.route ? { route: execution.route } : {}) };
  }

  private async executeExtraction(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<{ response: ModelResponse; route?: RoutingDecision }> {
    try {
      const execution = supportsAtomicRouting(this.intelligence)
        ? await this.intelligence.executeWithRouting(request, this.executionContext, signal)
        : { response: await this.intelligence.execute(request, this.executionContext, signal) };
      if (execution.response.type !== 'error' || !this.fallbackIntelligence) return execution;
    } catch (error) {
      if (signal.aborted || !this.fallbackIntelligence) throw error;
    }
    signal.throwIfAborted();
    return {
      response: await this.fallbackIntelligence!.execute(request, this.executionContext, signal),
    };
  }

  async confirm(agentId: string, fieldKey: string, accepted: boolean): Promise<OnboardingStep> {
    const agent = this.catalog.get(agentId);
    const question = agent.onboarding.find((candidate) => candidate.memoryKey === fieldKey);
    if (!question) throw new Error(`Unknown agent memory field: ${fieldKey}`);
    const entry = await this.memory.getMemoryEntry(agentId, fieldKey);
    if (!entry || entry.confirmationStatus !== 'pending') throw new Error('No pending memory value to confirm');
    const timestamp = this.now().toISOString();
    await this.memory.saveMemoryEntry({
      ...entry,
      confirmationStatus: accepted ? 'confirmed' : 'rejected',
      ...(accepted ? { confirmedAt: timestamp } : { confirmedAt: undefined }),
      updatedAt: timestamp,
    });
    return this.getStep(agentId, question.intent);
  }

  getMemory(agentId: string): Promise<AgentMemoryEntry[]> {
    this.catalog.get(agentId);
    return this.memory.getAgentMemory(agentId);
  }
}

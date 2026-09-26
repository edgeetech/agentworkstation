import type {
  IntelligencePort,
  ModelExecutionContext,
  ModelRequest,
  ModelResponse,
  RoutingDecision,
  RoutingPolicy,
} from '@domain/intelligence';

export type RoutingCandidate = {
  id: string;
  label: string;
  location: 'local' | 'external';
  modelId: string;
  intelligence: IntelligencePort;
  authDisclosure?: string;
};

export type RoutingAttempt = {
  candidate: RoutingCandidate;
  status: 'available' | 'limited' | 'unavailable';
  error?: string;
};

export type RoutedModelResponse = {
  response: ModelResponse;
  route: RoutingDecision;
};

/** Duck-typed: adapters that ran a real billed turn (e.g. ClaudeAgentSdkAdapter) expose this. */
interface UsageReportingIntelligence {
  getLastUsage(): { totalCostUsd: number | null; model?: string | null } | null;
}

function readLastCostUsd(intelligence: IntelligencePort): number | null {
  const reporter = intelligence as Partial<UsageReportingIntelligence>;
  if (typeof reporter.getLastUsage !== 'function') return null;
  return reporter.getLastUsage?.()?.totalCostUsd ?? null;
}

function readLastReportedModel(intelligence: IntelligencePort): string | null {
  const reporter = intelligence as Partial<UsageReportingIntelligence>;
  if (typeof reporter.getLastUsage !== 'function') return null;
  return reporter.getLastUsage?.()?.model ?? null;
}

export function promptNeedsStrongerReasoning(request: ModelRequest): boolean {
  const prompt = [...request.messages].reverse().find((message) => message.role === 'user')?.content.trim() ?? '';
  if (!prompt) return false;

  let score = 0;
  if (prompt.length >= 500) score += 1;
  if (prompt.length >= 1_200) score += 1;
  if ((prompt.match(/\?/g) ?? []).length >= 2) score += 1;
  if (/```|\b(stack trace|error log|diff|architecture|migration|security)\b/i.test(prompt)) score += 1;
  if (/\b(analy[sz]e|audit|compare|investigate|review|refactor|implement|debug|research|plan|reason|trade-?offs?|codebase|repository)\b/i.test(prompt)) score += 2;
  return score >= 2;
}

export class AdaptiveRoutingIntelligenceAdapter implements IntelligencePort {
  private lastDecision: RoutingDecision | null = null;

  constructor(
    private readonly policy: RoutingPolicy,
    local: RoutingCandidate | RoutingCandidate[] | null,
    external: RoutingCandidate | RoutingCandidate[] | null,
    private readonly attemptTimeouts = { localMs: 90_000, externalMs: 120_000 },
    private readonly onAttempt?: (attempt: RoutingAttempt) => void,
  ) {
    this.local = local ? (Array.isArray(local) ? local : [local]) : [];
    this.external = external ? (Array.isArray(external) ? external : [external]) : [];
  }

  private readonly local: RoutingCandidate[];
  private readonly external: RoutingCandidate[];

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  async execute(
    request: ModelRequest,
    context: ModelExecutionContext,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    return (await this.executeWithRouting(request, context, signal)).response;
  }

  async executeWithRouting(
    request: ModelRequest,
    context: ModelExecutionContext,
    signal: AbortSignal,
  ): Promise<RoutedModelResponse> {
    const candidates = this.candidatesFor(request, context);
    if (candidates.length === 0) {
      throw new Error(this.policy === 'local_only'
        ? 'Local only requires a configured local model.'
        : 'No eligible intelligence connection is configured for this routing policy.');
    }

    const failures: string[] = [];
    for (const [index, candidate] of candidates.entries()) {
      signal.throwIfAborted();
      const attemptAbort = new AbortController();
      const timeout = setTimeout(
        () => attemptAbort.abort(),
        candidate.location === 'local' ? this.attemptTimeouts.localMs : this.attemptTimeouts.externalMs,
      );
      try {
        const response = await candidate.intelligence.execute(
          request,
          {
            ...context,
            modelId: candidate.modelId,
            executionMode: candidate.location === 'external' ? 'provider_allowed' : 'local_only',
          },
          AbortSignal.any([signal, attemptAbort.signal]),
        );
        if (response.type === 'error') throw new Error(response.error);
        this.onAttempt?.({ candidate, status: 'available' });
        const route = this.decisionFor(
          candidate, context, index > 0, readLastCostUsd(candidate.intelligence), readLastReportedModel(candidate.intelligence),
        );
        this.lastDecision = route;
        return { response, route };
      } catch (error) {
        if (signal.aborted) throw error;
        const message = attemptAbort.signal.aborted
          ? 'route attempt timed out'
          : error instanceof Error ? error.message : String(error);
        this.onAttempt?.({
          candidate,
          status: /HTTP\s+429\b/i.test(message) ? 'limited' : 'unavailable',
          error: message,
        });
        failures.push(`${candidate.label}: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`All eligible intelligence routes failed. ${failures.join(' | ')}`);
  }

  private candidatesFor(request: ModelRequest, context: ModelExecutionContext): RoutingCandidate[] {
    if (this.policy === 'local_only') return this.local;
    const prefersExternal = context.taskKind === 'audit'
      || context.taskKind === 'proposal'
      || context.taskKind === 'onboarding_extraction'
      || (context.taskKind === 'chat' && promptNeedsStrongerReasoning(request));
    if (this.policy === 'adaptive' && prefersExternal) {
      return [...this.external, ...this.local];
    }
    return [...this.local, ...this.external];
  }

  private decisionFor(
    candidate: RoutingCandidate,
    context: ModelExecutionContext,
    fallback: boolean,
    costUsd: number | null = null,
    reportedModel: string | null = null,
  ): RoutingDecision {
    let reason: string;
    if (fallback) {
      reason = `The preferred route failed, so ${this.policy.replace('_', ' ')} used the configured fallback.`;
    } else if (this.policy === 'local_only') {
      reason = 'Local only kept this request on this device.';
    } else if (this.policy === 'adaptive' && candidate.location === 'external') {
      reason = `Automatic routing selected an allowed provider for ${context.taskKind ?? 'this task'} reasoning.`;
    } else if (this.policy === 'adaptive') {
      reason = 'Automatic routing selected an allowed local model for this request.';
    } else {
      reason = 'Local first selected the local model; the cloud fallback was not needed.';
    }
    return {
      policy: this.policy,
      location: candidate.location,
      providerId: candidate.id,
      providerLabel: candidate.label,
      modelId: candidate.modelId,
      reason,
      fallback,
      costUsd,
      reportedModel,
      authDisclosure: candidate.authDisclosure,
    };
  }
}

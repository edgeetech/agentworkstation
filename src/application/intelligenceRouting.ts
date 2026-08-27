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
};

export class AdaptiveRoutingIntelligenceAdapter implements IntelligencePort {
  private lastDecision: RoutingDecision | null = null;

  constructor(
    private readonly policy: RoutingPolicy,
    private readonly local: RoutingCandidate | null,
    private readonly external: RoutingCandidate | null,
    private readonly attemptTimeouts = { localMs: 30_000, externalMs: 90_000 },
  ) {}

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  async execute(
    request: ModelRequest,
    context: ModelExecutionContext,
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    const candidates = this.candidatesFor(context);
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
        this.lastDecision = this.decisionFor(candidate, context, index > 0);
        return response;
      } catch (error) {
        if (signal.aborted) throw error;
        failures.push(`${candidate.label}: ${attemptAbort.signal.aborted
          ? 'route attempt timed out'
          : error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`All eligible intelligence routes failed. ${failures.join(' | ')}`);
  }

  private candidatesFor(context: ModelExecutionContext): RoutingCandidate[] {
    if (this.policy === 'local_only') return this.local ? [this.local] : [];
    if (this.policy === 'adaptive' && (context.taskKind === 'audit' || context.taskKind === 'proposal')) {
      return [this.external, this.local].filter((candidate): candidate is RoutingCandidate => candidate !== null);
    }
    return [this.local, this.external].filter((candidate): candidate is RoutingCandidate => candidate !== null);
  }

  private decisionFor(
    candidate: RoutingCandidate,
    context: ModelExecutionContext,
    fallback: boolean,
  ): RoutingDecision {
    let reason: string;
    if (fallback) {
      reason = `The preferred route failed, so ${this.policy.replace('_', ' ')} used the configured fallback.`;
    } else if (this.policy === 'local_only') {
      reason = 'Local only kept this request on this device.';
    } else if (this.policy === 'adaptive' && candidate.location === 'external') {
      reason = `Adaptive selected the connected provider for ${context.taskKind ?? 'this task'} reasoning.`;
    } else if (this.policy === 'adaptive') {
      reason = 'Adaptive kept this request local because the task is suitable for the local model.';
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
    };
  }
}

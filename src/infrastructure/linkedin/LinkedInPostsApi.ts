import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  LinkedInPublisher,
  LinkedInShareRequest,
  LinkedInShareResult,
  LinkedInShareVerificationRequest,
  LinkedInShareVerifier,
} from '../../application/publication/publishers';
import type { LinkedInOAuthService } from '../../application/linkedin/connection';
import {
  createLinkedInPublisherConfiguration,
  type LinkedInPublisherConfiguration,
} from '../../domain/publication/configuration';

const LINKEDIN_POSTS_ENDPOINT = 'https://api.linkedin.com/rest/posts';

export interface LinkedInPostReceiptStore {
  get(key: string): Promise<LinkedInPostAttempt | null>;
  reserve(key: string): Promise<Readonly<{ created: boolean; attempt: LinkedInPostAttempt }>>;
  markAmbiguous(key: string): Promise<LinkedInPostAttempt>;
  succeed(key: string, value: LinkedInShareResult): Promise<LinkedInPostAttempt>;
}

export type LinkedInPostAttempt = Readonly<
  | { state: 'reserved'; reservedAt: string }
  | { state: 'ambiguous'; reservedAt: string; attemptedAt: string }
  | { state: 'succeeded'; result: LinkedInShareResult; succeededAt: string }
>;

export class AtomicLinkedInPostReceiptStore implements LinkedInPostReceiptStore {
  private operation = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(key: string): Promise<LinkedInPostAttempt | null> {
    await this.operation;
    const values = await this.read();
    return values[key] ?? null;
  }

  async reserve(key: string): Promise<Readonly<{ created: boolean; attempt: LinkedInPostAttempt }>> {
    return this.mutate(async (values) => {
      const existing = values[key];
      if (existing) {
        const result: Readonly<{ created: boolean; attempt: LinkedInPostAttempt }> =
          Object.freeze({ created: false, attempt: existing });
        return { changed: false, result };
      }
      const attempt = Object.freeze({ state: 'reserved' as const, reservedAt: new Date().toISOString() });
      values[key] = attempt;
      const result: Readonly<{ created: boolean; attempt: LinkedInPostAttempt }> =
        Object.freeze({ created: true, attempt });
      return { changed: true, result };
    });
  }

  async markAmbiguous(key: string): Promise<LinkedInPostAttempt> {
    return this.mutate(async (values) => {
      const existing = values[key];
      if (!existing) throw new Error('LinkedIn post reservation is missing');
      if (existing.state !== 'reserved') return { changed: false, result: existing };
      const attempt = Object.freeze({
        state: 'ambiguous' as const,
        reservedAt: existing.reservedAt,
        attemptedAt: new Date().toISOString(),
      });
      values[key] = attempt;
      return { changed: true, result: attempt };
    });
  }

  async succeed(key: string, value: LinkedInShareResult): Promise<LinkedInPostAttempt> {
    return this.mutate(async (values) => {
      const existing = values[key];
      if (!existing) throw new Error('LinkedIn post reservation is missing');
      if (existing.state === 'succeeded') return { changed: false, result: existing };
      const attempt = Object.freeze({
        state: 'succeeded' as const,
        result: Object.freeze({ ...value }),
        succeededAt: new Date().toISOString(),
      });
      values[key] = attempt;
      return { changed: true, result: attempt };
    });
  }

  private async mutate<T>(operation: (
    values: Record<string, LinkedInPostAttempt>,
  ) => Promise<{ changed: boolean; result: T }>): Promise<T> {
    let resolveResult!: (value: T) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const mutation = async (): Promise<void> => {
      const values = await this.read();
      try {
        const outcome = await operation(values);
        if (outcome.changed) await this.write(values);
        resolveResult(outcome.result);
      } catch (error) {
        rejectResult(error);
      }
    };
    this.operation = this.operation.then(mutation, mutation);
    await this.operation;
    return result;
  }

  private async write(values: Record<string, LinkedInPostAttempt>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(values), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async read(): Promise<Record<string, LinkedInPostAttempt>> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid LinkedIn receipt store');
      const records = value as Record<string, LinkedInPostAttempt | LinkedInShareResult>;
      return Object.fromEntries(Object.entries(records).map(([key, attempt]) => {
        if ('state' in attempt) return [key, attempt];
        // Existing successful receipts predate durable attempt states. Preserve their idempotency.
        return [key, Object.freeze({
          state: 'succeeded' as const,
          result: Object.freeze({ ...attempt }),
          succeededAt: new Date(0).toISOString(),
        })];
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}

function idempotencyKey(request: LinkedInShareRequest | LinkedInShareVerificationRequest): string {
  return createHash('sha256').update(JSON.stringify({
    workflowId: request.workflowId,
    contentId: request.contentId,
    authorUrn: request.authorUrn,
    commentary: request.commentary,
    publicationUrl: request.publicationUrl,
    approvedBy: request.approvedBy,
    approvedAt: request.approvedAt,
  })).digest('hex');
}

function requestHeaders(accessToken: string, apiVersion: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': apiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

export class LinkedInPostsApi implements LinkedInPublisher, LinkedInShareVerifier {
  private readonly inFlight = new Map<string, Promise<LinkedInShareResult>>();

  constructor(
    private readonly getConfiguration: () => Promise<LinkedInPublisherConfiguration | null>,
    private readonly oauth: Pick<LinkedInOAuthService, 'getValidCredential'>,
    private readonly receipts: LinkedInPostReceiptStore,
    private readonly http: { fetch(url: string, init: RequestInit): Promise<Response> } = {
      fetch: (url, init) => fetch(url, init),
    },
  ) {}

  async share(request: LinkedInShareRequest, signal: AbortSignal): Promise<LinkedInShareResult> {
    const key = idempotencyKey(request);
    const active = this.inFlight.get(key);
    if (active) return active;
    const operation = this.createPost(key, request, signal);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async createPost(
    key: string,
    request: LinkedInShareRequest,
    signal: AbortSignal,
  ): Promise<LinkedInShareResult> {
    // Complete every side-effect-free validation before claiming the durable
    // one-shot reservation. A setup or identity error must remain retryable.
    const configuration = await this.requireConfiguration();
    const credential = await this.oauth.getValidCredential(configuration);
    if (credential.member.subject !== request.memberSubject || credential.member.authorUrn !== request.authorUrn) {
      throw new Error('Approved LinkedIn member does not match the connected member');
    }
    const reservation = await this.receipts.reserve(key);
    if (reservation.attempt.state === 'succeeded') return reservation.attempt.result;
    if (!reservation.created) {
      throw new Error(
        'LinkedIn post is already in progress or its outcome is ambiguous; automatic retry is blocked to prevent a duplicate post',
      );
    }
    // Persist the ambiguity boundary before POST. A crash, timeout, or receipt-write
    // failure after this point must never turn into an automatic duplicate retry.
    const attempting = await this.receipts.markAmbiguous(key);
    if (attempting.state === 'succeeded') return attempting.result;
    if (attempting.state !== 'ambiguous') throw new Error('LinkedIn post reservation could not be activated');
    const response = await this.http.fetch(LINKEDIN_POSTS_ENDPOINT, {
      method: 'POST',
      headers: requestHeaders(credential.accessToken, configuration.apiVersion),
      body: JSON.stringify({
        author: request.authorUrn,
        commentary: request.commentary,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: { article: { source: request.publicationUrl } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
      signal,
    });
    if (response.status !== 201) throw new Error(`LinkedIn post creation failed (${response.status})`);
    const publisherReference = response.headers.get('x-restli-id')?.trim();
    if (!publisherReference) throw new Error('LinkedIn post creation did not return x-restli-id');
    const result = Object.freeze({ publisherReference });
    await this.receipts.succeed(key, result);
    return result;
  }

  async verify(request: LinkedInShareVerificationRequest, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const attempt = await this.receipts.get(idempotencyKey(request));
    if (attempt?.state !== 'succeeded' || attempt.result.publisherReference !== request.publisherReference) {
      throw new Error('LinkedIn post receipt does not match the exact approved post');
    }
    // w_member_social permits creating member posts but does not promise the
    // member-post read permission needed for a reliable Posts API GET. The
    // durable 201 receipt is therefore the verification boundary. Its key binds
    // author, exact commentary, approved publication URL, and approval identity.
  }

  private async requireConfiguration(): Promise<LinkedInPublisherConfiguration> {
    const configuration = await this.getConfiguration();
    if (!configuration) throw new Error('LinkedIn publisher setup is missing');
    return createLinkedInPublisherConfiguration(configuration);
  }
}

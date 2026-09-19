import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AtomicLinkedInPostReceiptStore,
  LinkedInPostsApi,
  type LinkedInPostAttempt,
  type LinkedInPostReceiptStore,
} from '../../../src/infrastructure/linkedin/LinkedInPostsApi';
import type { LinkedInShareRequest } from '../../../src/application/publication/publishers';

const request: LinkedInShareRequest = Object.freeze({
  workflowId: 'workflow-1', contentId: 'article-1', connectionReference: 'linkedin:oidc:member-1',
  publicationUrl: 'https://blog.example.com/articles/one', commentary: 'Exact text\nwith spacing.',
  authorUrn: 'urn:li:person:member-1', memberSubject: 'member-1', approvedBy: 'Reviewer',
  approvedAt: '2026-09-11T10:00:00.000Z',
});

class MemoryReceipts implements LinkedInPostReceiptStore {
  readonly values = new Map<string, LinkedInPostAttempt>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async reserve(key: string) {
    const existing = this.values.get(key);
    if (existing) return { created: false, attempt: existing };
    const value = { state: 'reserved' as const, reservedAt: '2026-09-11T10:00:00.000Z' };
    this.values.set(key, value);
    return { created: true, attempt: value };
  }
  async markAmbiguous(key: string) {
    let value = this.values.get(key);
    if (!value) throw new Error('missing reservation');
    if (value.state === 'reserved') {
      value = {
        state: 'ambiguous',
        reservedAt: value.reservedAt,
        attemptedAt: '2026-09-11T10:00:01.000Z',
      };
      this.values.set(key, value);
    }
    return value;
  }
  async succeed(key: string, result: { publisherReference: string }) {
    const value = { state: 'succeeded' as const, result, succeededAt: '2026-09-11T10:00:02.000Z' };
    this.values.set(key, value);
    return value;
  }
}

describe('LinkedInPostsApi', () => {
  it('posts exact approved copy with required version headers and reuses the 201 receipt idempotently', async () => {
    const receipts = new MemoryReceipts();
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } });
    });
    const api = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }),
      { getValidCredential: vi.fn(async () => ({ accessToken: 'secret-token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' } })) },
      receipts,
      { fetch },
    );
    const first = await api.share(request, new AbortController().signal);
    const second = await api.share(request, new AbortController().signal);
    expect(first).toEqual({ publisherReference: 'urn:li:share:123' });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe('https://api.linkedin.com/rest/posts');
    expect(capturedInit?.headers).toMatchObject({
      Authorization: 'Bearer secret-token', 'Linkedin-Version': '202608', 'X-Restli-Protocol-Version': '2.0.0',
    });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      author: request.authorUrn, commentary: request.commentary, visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article: { source: request.publicationUrl } }, lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });

    await expect(api.verify({
      ...request,
      publisherReference: first.publisherReference,
      executedBy: 'Publisher',
      executedAt: '2026-09-11T10:00:03.000Z',
    }, new AbortController().signal)).resolves.toBeUndefined();
    await expect(api.verify({
      ...request,
      publicationUrl: 'https://blog.example.com/articles/different',
      publisherReference: first.publisherReference,
      executedBy: 'Publisher',
      executedAt: '2026-09-11T10:00:03.000Z',
    }, new AbortController().signal)).rejects.toThrow('exact approved post');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical shares into one external POST', async () => {
    const receipts = new MemoryReceipts();
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const fetch = vi.fn(async () => {
      await released;
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } });
    });
    const api = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }),
      { getValidCredential: vi.fn(async () => ({
        accessToken: 'secret-token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' },
      })) },
      receipts,
      { fetch },
    );

    const first = api.share(request, new AbortController().signal);
    const second = api.share(request, new AbortController().signal);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { publisherReference: 'urn:li:share:123' },
      { publisherReference: 'urn:li:share:123' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('blocks a second publisher instance after the durable reservation is claimed', async () => {
    const receipts = new MemoryReceipts();
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const firstFetch = vi.fn(async () => {
      await released;
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } });
    });
    const secondFetch = vi.fn(async () =>
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:duplicate' } }));
    const credentials = { getValidCredential: vi.fn(async () => ({
      accessToken: 'secret-token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' },
    })) };
    const firstApi = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }), credentials, receipts, { fetch: firstFetch },
    );
    const secondApi = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }), credentials, receipts, { fetch: secondFetch },
    );

    const first = firstApi.share(request, new AbortController().signal);
    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));
    await expect(secondApi.share(request, new AbortController().signal))
      .rejects.toThrow('automatic retry is blocked');
    expect(secondFetch).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toEqual({ publisherReference: 'urn:li:share:123' });
  });

  it('keeps a receipt-write failure ambiguous and blocks automatic POST after restart', async () => {
    const receipts = new MemoryReceipts();
    receipts.succeed = vi.fn(async () => { throw new Error('receipt disk write failed'); });
    const firstFetch = vi.fn(async () =>
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:123' } }));
    const create = (fetch: typeof firstFetch) => new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }),
      { getValidCredential: vi.fn(async () => ({
        accessToken: 'secret-token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' },
      })) },
      receipts,
      { fetch },
    );

    await expect(create(firstFetch).share(request, new AbortController().signal))
      .rejects.toThrow('receipt disk write failed');
    expect([...receipts.values.values()][0]?.state).toBe('ambiguous');

    const afterRestartFetch = vi.fn(async () =>
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:duplicate' } }));
    await expect(create(afterRestartFetch).share(request, new AbortController().signal))
      .rejects.toThrow('automatic retry is blocked');
    expect(afterRestartFetch).not.toHaveBeenCalled();
  });

  it('persists an ambiguous pre-POST boundary across receipt-store reconstruction', async () => {
    const receiptFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linkedin-attempt-')), 'receipts.json');
    const credentials = { getValidCredential: vi.fn(async () => ({
      accessToken: 'secret-token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' },
    })) };
    const firstFetch = vi.fn(async () => { throw new Error('connection reset after request dispatch'); });
    const first = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }),
      credentials,
      new AtomicLinkedInPostReceiptStore(receiptFile),
      { fetch: firstFetch },
    );
    await expect(first.share(request, new AbortController().signal))
      .rejects.toThrow('connection reset');

    const afterRestartFetch = vi.fn(async () =>
      new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:duplicate' } }));
    const reconstructed = new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }),
      credentials,
      new AtomicLinkedInPostReceiptStore(receiptFile),
      { fetch: afterRestartFetch },
    );
    await expect(reconstructed.share(request, new AbortController().signal))
      .rejects.toThrow('automatic retry is blocked');
    expect(afterRestartFetch).not.toHaveBeenCalled();
  });

  it('rejects member drift, non-201 responses, and missing x-restli-id', async () => {
    const credentials = { getValidCredential: vi.fn(async () => ({
      accessToken: 'token', member: { subject: 'different', authorUrn: 'urn:li:person:different' },
    })) };
    const make = (fetch: (url: string, init: RequestInit) => Promise<Response>) => new LinkedInPostsApi(
      async () => ({ clientId: 'client-id', apiVersion: '202608' }), credentials, new MemoryReceipts(), { fetch },
    );
    await expect(make(vi.fn(async (_url: string, _init: RequestInit) => new Response())).share(request, new AbortController().signal)).rejects.toThrow('connected member');
    credentials.getValidCredential.mockResolvedValue({
      accessToken: 'token', member: { subject: 'member-1', authorUrn: 'urn:li:person:member-1' },
    });
    await expect(make(vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 429 }))).share(request, new AbortController().signal))
      .rejects.toThrow('(429)');
    await expect(make(vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 }))).share(request, new AbortController().signal))
      .rejects.toThrow('x-restli-id');
  });
});

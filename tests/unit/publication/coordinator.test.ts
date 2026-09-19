import { describe, expect, it, vi } from 'vitest';
import { PublicationCoordinator } from '../../../src/application/publication/PublicationCoordinator';
import type { PublicationPersistence } from '../../../src/application/publication/persistence';
import type { PublicationWorkflow } from '../../../src/domain/publication/workflow';
import { createPublicationBundle } from '../../../src/domain/publication/workflow';
import {
  createLinkedInConnectionReference,
  createPublicationSiteTarget,
  type LinkedInConnectionReference,
  type PublicationSiteTarget,
} from '../../../src/domain/publication/configuration';

const signal = new AbortController().signal;
const at = (actorLabel: string, second: number) => ({
  actorLabel,
  at: `2026-09-10T10:00:${second.toString().padStart(2, '0')}.000Z`,
});
const target = createPublicationSiteTarget({
  displayDomain: 'blog.example.com',
  workspaceId: 'blog-workspace',
  contentDirectory: 'content/articles',
  publishBranch: 'main',
  publicBaseUrl: 'https://blog.example.com/articles',
});
const connection = createLinkedInConnectionReference('linkedin:connection/team-account');
const bundle = createPublicationBundle({
  contentId: 'post-1',
  primaryArticlePath: 'content/articles/post.md',
  artifacts: [
    { path: 'content/articles/post.md', sha256: 'a'.repeat(64), role: 'primary-article' },
    { path: 'content/articles/post.tr.md', sha256: 'b'.repeat(64), role: 'translation' },
  ],
});

class MemoryPublicationPersistence implements PublicationPersistence {
  workflow: PublicationWorkflow | null = null;
  saves: PublicationWorkflow[] = [];
  siteTarget: PublicationSiteTarget | null = null;
  linkedInConnection: LinkedInConnectionReference | null = null;
  history: PublicationWorkflow[] = [];

  async getSiteTarget() { return this.siteTarget; }
  async saveSiteTarget(value: PublicationSiteTarget) { this.siteTarget = value; }
  async clearSiteTarget() { this.siteTarget = null; }
  async getLinkedInConnectionReference() { return this.linkedInConnection; }
  async saveLinkedInConnectionReference(value: LinkedInConnectionReference) {
    this.linkedInConnection = value;
  }
  async clearLinkedInConnectionReference() { this.linkedInConnection = null; }
  async getActiveWorkflow() { return this.workflow; }
  async saveActiveWorkflow(value: PublicationWorkflow) {
    this.workflow = value;
    this.saves.push(value);
  }
  async getWorkflowHistory() { return this.history; }
  async archiveActiveWorkflow(value: PublicationWorkflow) {
    this.history.unshift(value);
    this.workflow = null;
  }
}

function startInput() {
  return {
    id: 'publication-1',
    bundle,
    target,
    linkedInConnection: connection,
    requestedBy: at('author', 0),
  };
}

describe('PublicationCoordinator', () => {
  it('serializes concurrent starts so only one workflow becomes active', async () => {
    const persistence = new MemoryPublicationPersistence();
    const coordinator = new PublicationCoordinator(
      persistence,
      { publish: vi.fn() },
      { verify: vi.fn() },
      { share: vi.fn() },
      { verify: vi.fn() },
    );

    const results = await Promise.allSettled([
      coordinator.start(startInput()),
      coordinator.start({ ...startInput(), id: 'publication-2' }),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
    expect(persistence.workflow?.id).toBe('publication-1');
    expect(persistence.saves).toHaveLength(1);
  });

  it('queues dependent concurrent mutations and never duplicates external publication or sharing', async () => {
    const persistence = new MemoryPublicationPersistence();
    const sitePublisher = { publish: vi.fn().mockResolvedValue({
      publicationUrl: 'https://blog.example.com/articles/post',
      publisherReference: '0123456789abcdef0123456789abcdef01234567',
    }) };
    const linkedInPublisher = { share: vi.fn().mockResolvedValue({
      publisherReference: 'linkedin:activity:99',
    }) };
    const coordinator = new PublicationCoordinator(
      persistence,
      sitePublisher,
      { verify: vi.fn().mockResolvedValue(undefined) },
      linkedInPublisher,
      { verify: vi.fn().mockResolvedValue(undefined) },
    );
    await coordinator.start(startInput());

    const siteResults = await Promise.all([
      coordinator.approveSite(at('site-approver', 1)),
      coordinator.publish(at('site-publisher', 2), at('site-verifier', 3), signal),
    ]);
    expect(siteResults[1].stage).toBe('SITE_PUBLISHED_VERIFIED');

    const socialResults = await Promise.all([
      coordinator.requestLinkedInApproval({
        commentary: 'Exact commentary',
        publicationUrl: 'https://blog.example.com/articles/post',
        authorUrn: 'urn:li:person:member-123',
        memberSubject: 'member-123',
      }, at('social-owner', 4)),
      coordinator.approveLinkedIn(at('social-approver', 5)),
      coordinator.share(at('social-publisher', 6), at('social-verifier', 7), signal),
      coordinator.archiveCompleted(),
    ]);
    expect(socialResults[2].stage).toBe('LINKEDIN_SHARED_VERIFIED');
    expect(persistence.workflow).toBeNull();
    expect(persistence.history).toHaveLength(1);
    expect(sitePublisher.publish).toHaveBeenCalledTimes(1);
    expect(linkedInPublisher.share).toHaveBeenCalledTimes(1);
  });

  it('serializes duplicate publish requests and performs the external call once', async () => {
    const persistence = new MemoryPublicationPersistence();
    const sitePublisher = { publish: vi.fn().mockResolvedValue({
      publicationUrl: 'https://blog.example.com/articles/post',
      publisherReference: '0123456789abcdef0123456789abcdef01234567',
    }) };
    const coordinator = new PublicationCoordinator(
      persistence,
      sitePublisher,
      { verify: vi.fn().mockResolvedValue(undefined) },
      { share: vi.fn() },
      { verify: vi.fn() },
    );
    await coordinator.start(startInput());
    await coordinator.approveSite(at('site-approver', 1));

    const results = await Promise.allSettled([
      coordinator.publish(at('site-publisher', 2), at('site-verifier', 3), signal),
      coordinator.publish(at('duplicate-publisher', 4), at('duplicate-verifier', 5), signal),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
    expect(sitePublisher.publish).toHaveBeenCalledTimes(1);
    expect(persistence.workflow?.stage).toBe('SITE_PUBLISHED_VERIFIED');
  });

  it('persists a site attempt before verification and retries without republishing', async () => {
    const persistence = new MemoryPublicationPersistence();
    const sitePublisher = { publish: vi.fn().mockResolvedValue({
      publicationUrl: 'https://blog.example.com/articles/post',
      publisherReference: '0123456789abcdef0123456789abcdef01234567',
    }) };
    const siteVerifier = { verify: vi.fn()
      .mockRejectedValueOnce(new Error('not live yet'))
      .mockResolvedValueOnce(undefined) };
    const coordinator = new PublicationCoordinator(
      persistence,
      sitePublisher,
      siteVerifier,
      { share: vi.fn() },
      { verify: vi.fn() },
    );

    await coordinator.start(startInput());
    await coordinator.approveSite(at('site-approver', 1));
    await expect(coordinator.publish(at('site-publisher', 2), at('site-verifier', 3), signal))
      .rejects.toThrow('not live yet');

    expect(persistence.workflow?.stage).toBe('SITE_PUBLICATION_AWAITING_VERIFICATION');
    expect(persistence.workflow?.sitePublicationAttempt).toMatchObject({
      publisherReference: '0123456789abcdef0123456789abcdef01234567',
      executedBy: 'site-publisher',
    });

    const retries = await Promise.allSettled([
      coordinator.retrySiteVerification(at('site-verifier', 4), signal),
      coordinator.retrySiteVerification(at('duplicate-verifier', 5), signal),
    ]);
    expect(retries.map(({ status }) => status)).toEqual(['fulfilled', 'rejected']);
    expect(retries[0].status === 'fulfilled' && retries[0].value.stage).toBe('SITE_PUBLISHED_VERIFIED');
    expect(sitePublisher.publish).toHaveBeenCalledTimes(1);
    expect(siteVerifier.verify).toHaveBeenCalledTimes(2);
  });

  it('saves both LinkedIn approval transitions and retries verification without resharing', async () => {
    const persistence = new MemoryPublicationPersistence();
    const linkedInPublisher = { share: vi.fn().mockResolvedValue({
      publisherReference: 'linkedin:activity:99',
      shareUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:99',
    }) };
    const linkedInVerifier = { verify: vi.fn()
      .mockRejectedValueOnce(new Error('share not observable'))
      .mockResolvedValueOnce(undefined) };
    const coordinator = new PublicationCoordinator(
      persistence,
      { publish: vi.fn().mockResolvedValue({
        publicationUrl: 'https://blog.example.com/articles/post',
        publisherReference: '0123456789abcdef0123456789abcdef01234567',
      }) },
      { verify: vi.fn().mockResolvedValue(undefined) },
      linkedInPublisher,
      linkedInVerifier,
    );

    await coordinator.start(startInput());
    await coordinator.approveSite(at('site-approver', 1));
    await coordinator.publish(at('site-publisher', 2), at('site-verifier', 3), signal);
    const savesBeforeApproval = persistence.saves.length;
    await coordinator.requestLinkedInApproval({
      commentary: 'Exact commentary',
      publicationUrl: 'https://blog.example.com/articles/post',
      authorUrn: 'urn:li:person:member-123',
      memberSubject: 'member-123',
    }, at('social-owner', 4));
    expect(persistence.workflow?.stage).toBe('LINKEDIN_APPROVAL_PENDING');
    await coordinator.approveLinkedIn(at('social-approver', 5));
    expect(persistence.saves.slice(savesBeforeApproval).map(({ stage }) => stage)).toEqual([
      'LINKEDIN_APPROVAL_PENDING',
      'LINKEDIN_APPROVED',
    ]);

    await expect(coordinator.share(at('social-publisher', 6), at('social-verifier', 7), signal))
      .rejects.toThrow('share not observable');
    expect(persistence.workflow?.stage).toBe('LINKEDIN_SHARE_AWAITING_VERIFICATION');
    expect(persistence.workflow?.linkedInShareAttempt?.executedBy).toBe('social-publisher');

    const verified = await coordinator.retryLinkedInVerification(at('social-verifier', 8), signal);
    expect(verified.stage).toBe('LINKEDIN_SHARED_VERIFIED');
    expect(linkedInPublisher.share).toHaveBeenCalledTimes(1);
    expect(linkedInVerifier.verify).toHaveBeenCalledTimes(2);
  });

  it('archives only a completed workflow and never discards an awaiting external attempt', async () => {
    const persistence = new MemoryPublicationPersistence();
    const coordinator = new PublicationCoordinator(
      persistence,
      { publish: vi.fn().mockResolvedValue({
        publicationUrl: 'https://blog.example.com/articles/post',
        publisherReference: '0123456789abcdef0123456789abcdef01234567',
      }) },
      { verify: vi.fn().mockRejectedValue(new Error('not propagated')) },
      { share: vi.fn() },
      { verify: vi.fn() },
    );
    await coordinator.start(startInput());
    await expect(coordinator.archiveCompleted()).rejects.toThrow('cannot be archived');
    await coordinator.approveSite(at('approver', 1));
    await expect(coordinator.publish(at('publisher', 2), at('verifier', 3), signal)).rejects.toThrow('not propagated');
    await expect(coordinator.archiveCompleted()).rejects.toThrow('cannot be archived');
    expect(persistence.workflow?.stage).toBe('SITE_PUBLICATION_AWAITING_VERIFICATION');
    expect(persistence.history).toHaveLength(0);
  });
});

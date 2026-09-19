import { describe, expect, it } from 'vitest';
import { createLinkedInConnectionReference, createPublicationSiteTarget } from '../../../src/domain/publication/configuration';
import {
  approveLinkedInShare,
  approveSitePublication,
  createPublicationWorkflow,
  createPublicationBundle,
  recordLinkedInShareExecution,
  recordSitePublicationExecution,
  requestLinkedInApproval,
  verifyLinkedInShare,
  verifySitePublication,
  type AuditIdentity,
  type PublicationWorkflow,
} from '../../../src/domain/publication/workflow';
import {
  buildLinkedInShareRequest,
  buildLinkedInShareVerificationRequest,
  buildSitePublicationRequest,
  buildSitePublicationVerificationRequest,
} from '../../../src/application/publication/publishers';

const target = createPublicationSiteTarget({
  displayDomain: 'blog.example.com',
  workspaceId: 'blog-workspace',
  contentDirectory: 'content/articles',
  publishBranch: 'main',
  publicBaseUrl: 'https://blog.example.com/articles',
});
const bundle = createPublicationBundle({
  contentId: 'article-1',
  primaryArticlePath: 'content/articles/article-1.md',
  artifacts: [
    { path: 'content/articles/article-1.md', sha256: 'a'.repeat(64), role: 'primary-article' },
    { path: 'content/articles/article-1.tr.md', sha256: 'b'.repeat(64), role: 'translation' },
  ],
});
const connection = createLinkedInConnectionReference('linkedin:connection/team-account');
const siteResult = {
  publicationUrl: 'https://blog.example.com/articles/production-foundation',
  publisherReference: 'site-deployment-42',
};
const socialRequest = {
  commentary: 'Read the production article.\n\nBuilt with explicit approvals.',
  publicationUrl: siteResult.publicationUrl,
  authorUrn: 'urn:li:person:member-123',
  memberSubject: 'member-123',
  memberDisplayName: 'Member Name',
};

const identity = (actorLabel: string, second: number): AuditIdentity => ({
  actorLabel,
  at: `2026-09-10T10:00:${second.toString().padStart(2, '0')}.000Z`,
});

function newWorkflow(withConnection = true): PublicationWorkflow {
  return createPublicationWorkflow({
    id: 'publication-1',
    bundle,
    target,
    ...(withConnection ? { linkedInConnection: connection } : {}),
    requestedBy: identity('author', 0),
  });
}

function verifiedSiteWorkflow(withConnection = true): PublicationWorkflow {
  const approved = approveSitePublication(newWorkflow(withConnection), identity('site-approver', 1));
  const executed = recordSitePublicationExecution(approved, siteResult, identity('site-publisher', 2));
  return verifySitePublication(executed, identity('site-verifier', 3));
}

describe('publication workflow', () => {
  it('validates and deeply freezes the exact bilingual publication bundle', () => {
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.artifacts)).toBe(true);
    expect(bundle.artifacts.every(Object.isFrozen)).toBe(true);
    expect(() => createPublicationBundle({
      contentId: 'duplicate',
      primaryArticlePath: 'content/articles/post.md',
      artifacts: [
        { path: 'content/articles/post.md', sha256: 'a'.repeat(64), role: 'primary-article' },
        { path: 'content/articles/post.md', sha256: 'b'.repeat(64), role: 'translation' },
      ],
    })).toThrow('must be unique');
    expect(() => createPublicationBundle({
      contentId: 'missing-translation',
      primaryArticlePath: 'content/articles/post.md',
      artifacts: [{ path: 'content/articles/post.md', sha256: 'not-a-hash', role: 'primary-article' }],
    })).toThrow('SHA-256');
    expect(() => createPublicationBundle({
      contentId: 'missing-translation',
      primaryArticlePath: '../post.md',
      artifacts: [{ path: '../post.md', sha256: 'a'.repeat(64), role: 'primary-article' }],
    })).toThrow(/traversal|relative/u);
  });

  it('uses an explicit immutable state machine and preserves earlier snapshots', () => {
    const pending = newWorkflow();
    const approved = approveSitePublication(pending, identity('site-approver', 1));

    expect(pending.stage).toBe('SITE_APPROVAL_PENDING');
    expect(pending.siteApproval).toBeUndefined();
    expect(approved.stage).toBe('SITE_APPROVED');
    expect(approved.siteApproval).toEqual({
      approvedBy: 'site-approver',
      approvedAt: '2026-09-10T10:00:01.000Z',
    });
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.siteApproval)).toBe(true);
    expect(Object.isFrozen(approved.auditTrail)).toBe(true);
    expect(Object.isFrozen(approved.auditTrail[1])).toBe(true);
  });

  it('requires site approval before building or recording publication execution', () => {
    const pending = newWorkflow();

    expect(() => buildSitePublicationRequest(pending)).toThrow('explicit site approval');
    expect(() => recordSitePublicationExecution(pending, siteResult, identity('publisher', 1)))
      .toThrow('requires SITE_APPROVED');
  });

  it('builds a side-effect-free site publisher request only after approval', () => {
    const approved = approveSitePublication(newWorkflow(), identity('site-approver', 1));

    expect(buildSitePublicationRequest(approved)).toEqual({
      workflowId: 'publication-1',
      contentId: 'article-1',
      bundle,
      target,
      approvedBy: 'site-approver',
      approvedAt: '2026-09-10T10:00:01.000Z',
    });
  });

  it('does not treat publisher execution as verified site publication', () => {
    const approved = approveSitePublication(newWorkflow(), identity('site-approver', 1));
    const executed = recordSitePublicationExecution(approved, siteResult, identity('site-publisher', 2));

    expect(executed.stage).toBe('SITE_PUBLICATION_AWAITING_VERIFICATION');
    expect(executed.sitePublicationAttempt).toEqual({
      ...siteResult,
      executedBy: 'site-publisher',
      executedAt: '2026-09-10T10:00:02.000Z',
    });
    expect(executed.sitePublication).toBeUndefined();
    expect(buildSitePublicationVerificationRequest(executed)).toEqual({
      workflowId: 'publication-1',
      contentId: 'article-1',
      ...executed.sitePublicationAttempt,
    });
    expect(() => requestLinkedInApproval(executed, socialRequest, identity('social-owner', 3)))
      .toThrow('requires SITE_PUBLISHED_VERIFIED');
  });

  it('requires verified publication URLs to match the configured public site boundary', () => {
    const approved = approveSitePublication(newWorkflow(), identity('site-approver', 1));
    expect(() => recordSitePublicationExecution(approved, {
      publicationUrl: 'https://blog.example.com/outside/article',
      publisherReference: 'site-deployment-42',
    }, identity('site-publisher', 2))).toThrow('within publicBaseUrl');
    expect(() => recordSitePublicationExecution(approved, {
      publicationUrl: 'https://other.example.com/articles/article',
      publisherReference: 'site-deployment-42',
    }, identity('site-publisher', 2))).toThrow('on displayDomain');
  });

  it('binds the authenticated member even when the site workflow began without a connection', () => {
    const published = verifiedSiteWorkflow(false);
    const pending = requestLinkedInApproval(published, socialRequest, identity('social-owner', 4));
    expect(pending.linkedInConnection?.reference).toBe('linkedin:oidc:member-123');
  });

  it('uses a separate LinkedIn approval after verified site publication', () => {
    const sitePublished = verifiedSiteWorkflow();
    const socialPending = requestLinkedInApproval(sitePublished, socialRequest, identity('social-owner', 4));
    const socialApproved = approveLinkedInShare(socialPending, identity('social-approver', 5));

    expect(sitePublished.siteApproval?.approvedBy).toBe('site-approver');
    expect(socialApproved.linkedInApproval).toEqual({
      ...socialRequest,
      approvedBy: 'social-approver',
      approvedAt: '2026-09-10T10:00:05.000Z',
    });
    expect(socialApproved.auditTrail.map((entry) => entry.action)).toEqual([
      'SITE_APPROVAL_REQUESTED',
      'SITE_PUBLICATION_APPROVED',
      'SITE_PUBLICATION_EXECUTED',
      'SITE_PUBLICATION_VERIFIED',
      'LINKEDIN_APPROVAL_REQUESTED',
      'LINKEDIN_SHARE_APPROVED',
    ]);
    expect(Object.isFrozen(socialApproved.linkedInApprovalRequest)).toBe(true);
    expect(Object.isFrozen(socialApproved.linkedInApproval)).toBe(true);
  });

  it('cannot approve unspecified or substituted LinkedIn copy, URL, or member identity', () => {
    const published = verifiedSiteWorkflow(false);
    expect(() => requestLinkedInApproval(published, { ...socialRequest, commentary: '   ' }, identity('owner', 4)))
      .toThrow('commentary is required');
    expect(() => requestLinkedInApproval(published, {
      ...socialRequest, publicationUrl: 'https://blog.example.com/articles/different',
    }, identity('owner', 4))).toThrow('exact verified publication URL');
    expect(() => requestLinkedInApproval(published, {
      ...socialRequest, authorUrn: 'urn:li:organization:123',
    }, identity('owner', 4))).toThrow('authenticated member');
  });

  it('cannot approve or execute LinkedIn sharing out of order', () => {
    const pendingSite = newWorkflow();

    expect(() => approveLinkedInShare(pendingSite, identity('social-approver', 1)))
      .toThrow('requires LINKEDIN_APPROVAL_PENDING');
    expect(() => recordLinkedInShareExecution(pendingSite, {
      publisherReference: 'linkedin-share-99',
    }, identity('social-publisher', 1)))
      .toThrow('requires LINKEDIN_APPROVED');
    expect(() => buildLinkedInShareRequest(pendingSite))
      .toThrow('verified site publication');
  });

  it('builds a credential-free LinkedIn request only after its own approval', () => {
    const socialApproved = approveLinkedInShare(
      requestLinkedInApproval(verifiedSiteWorkflow(), socialRequest, identity('social-owner', 4)),
      identity('social-approver', 5),
    );

    expect(buildLinkedInShareRequest(socialApproved)).toEqual({
      workflowId: 'publication-1',
      contentId: 'article-1',
      connectionReference: 'linkedin:oidc:member-123',
      publicationUrl: 'https://blog.example.com/articles/production-foundation',
      commentary: socialRequest.commentary,
      authorUrn: socialRequest.authorUrn,
      memberSubject: socialRequest.memberSubject,
      approvedBy: 'social-approver',
      approvedAt: '2026-09-10T10:00:05.000Z',
    });
  });

  it('tracks execution and verification as distinct LinkedIn states', () => {
    const approved = approveLinkedInShare(
      requestLinkedInApproval(verifiedSiteWorkflow(), socialRequest, identity('social-owner', 4)),
      identity('social-approver', 5),
    );
    const executed = recordLinkedInShareExecution(approved, {
      publisherReference: 'linkedin-share-99',
      shareUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:99',
    }, identity('social-publisher', 6));
    const verified = verifyLinkedInShare(executed, identity('social-verifier', 7));

    expect(executed.stage).toBe('LINKEDIN_SHARE_AWAITING_VERIFICATION');
    expect(executed.linkedInShareAttempt?.executedBy).toBe('social-publisher');
    expect(executed.linkedInShare).toBeUndefined();
    expect(buildLinkedInShareVerificationRequest(executed).publisherReference)
      .toBe('linkedin-share-99');
    expect(verified.stage).toBe('LINKEDIN_SHARED_VERIFIED');
    expect(verified.linkedInShare?.verifiedBy).toBe('social-verifier');
    expect(Object.isFrozen(verified.linkedInShare)).toBe(true);
  });

  it('rejects malformed, secret-like, and non-monotonic audit data', () => {
    expect(() => createPublicationWorkflow({
      id: 'publication-1',
      bundle,
      target,
      requestedBy: { actorLabel: 'author', at: 'September 10' },
    })).toThrow('exact UTC ISO-8601');

    const pending = newWorkflow();
    expect(() => approveSitePublication(pending, identity('approver', 0)))
      .not.toThrow();
    expect(() => approveSitePublication(pending, {
      actorLabel: 'approver',
      at: '2026-09-10T09:59:59.000Z',
    })).toThrow('must not move backwards');

    const executed = recordSitePublicationExecution(
      approveSitePublication(pending, identity('approver', 1)),
      siteResult,
      identity('publisher', 2),
    );
    expect(() => recordSitePublicationExecution(
      approveSitePublication(pending, identity('approver', 1)), {
      publicationUrl: 'https://blog.example.com/articles/article',
      publisherReference: 'token=do-not-store-this',
    }, identity('publisher', 2))).toThrow('credentials are not allowed');
    expect(() => verifySitePublication(executed, identity('verifier', 1)))
      .toThrow('must not move backwards');
  });
});

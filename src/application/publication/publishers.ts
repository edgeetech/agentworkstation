import type { PublicationSiteTarget } from '../../domain/publication/configuration';
import type { PublicationBundle, PublicationWorkflow } from '../../domain/publication/workflow';

export type SitePublicationRequest = Readonly<{
  workflowId: string;
  contentId: string;
  bundle: PublicationBundle;
  target: PublicationSiteTarget;
  approvedBy: string;
  approvedAt: string;
}>;

export type SitePublicationResult = Readonly<{
  publicationUrl: string;
  publisherReference: string;
}>;

export interface SitePublisher {
  publish(request: SitePublicationRequest, signal: AbortSignal): Promise<SitePublicationResult>;
}

export type SitePublicationVerificationRequest = Readonly<{
  workflowId: string;
  contentId: string;
  publicationUrl: string;
  publisherReference: string;
  executedBy: string;
  executedAt: string;
}>;

export interface SitePublicationVerifier {
  verify(request: SitePublicationVerificationRequest, signal: AbortSignal): Promise<unknown>;
}

export type LinkedInShareRequest = Readonly<{
  workflowId: string;
  contentId: string;
  connectionReference: string;
  publicationUrl: string;
  commentary: string;
  authorUrn: string;
  memberSubject: string;
  approvedBy: string;
  approvedAt: string;
}>;

export type LinkedInShareResult = Readonly<{
  publisherReference: string;
  shareUrl?: string;
}>;

export interface LinkedInPublisher {
  share(request: LinkedInShareRequest, signal: AbortSignal): Promise<LinkedInShareResult>;
}

export type LinkedInShareVerificationRequest = Readonly<{
  workflowId: string;
  contentId: string;
  connectionReference: string;
  publicationUrl: string;
  commentary: string;
  authorUrn: string;
  approvedBy: string;
  approvedAt: string;
  publisherReference: string;
  shareUrl?: string;
  executedBy: string;
  executedAt: string;
}>;

export interface LinkedInShareVerifier {
  verify(request: LinkedInShareVerificationRequest, signal: AbortSignal): Promise<unknown>;
}

export function buildSitePublicationRequest(workflow: PublicationWorkflow): SitePublicationRequest {
  if (workflow.stage !== 'SITE_APPROVED' || !workflow.siteApproval) {
    throw new Error('A site publication request requires explicit site approval');
  }
  return Object.freeze({
    workflowId: workflow.id,
    contentId: workflow.contentId,
    bundle: workflow.bundle,
    target: workflow.target,
    approvedBy: workflow.siteApproval.approvedBy,
    approvedAt: workflow.siteApproval.approvedAt,
  });
}

export function buildLinkedInShareRequest(workflow: PublicationWorkflow): LinkedInShareRequest {
  if (
    workflow.stage !== 'LINKEDIN_APPROVED'
    || !workflow.linkedInApproval
    || !workflow.sitePublication
    || !workflow.linkedInConnection
  ) {
    throw new Error(
      'A LinkedIn share request requires verified site publication, a connection reference, and explicit LinkedIn approval',
    );
  }
  return Object.freeze({
    workflowId: workflow.id,
    contentId: workflow.contentId,
    connectionReference: workflow.linkedInConnection.reference,
    publicationUrl: workflow.sitePublication.publicationUrl,
    commentary: workflow.linkedInApproval.commentary,
    authorUrn: workflow.linkedInApproval.authorUrn,
    memberSubject: workflow.linkedInApproval.memberSubject,
    approvedBy: workflow.linkedInApproval.approvedBy,
    approvedAt: workflow.linkedInApproval.approvedAt,
  });
}

export function buildSitePublicationVerificationRequest(
  workflow: PublicationWorkflow,
): SitePublicationVerificationRequest {
  if (workflow.stage !== 'SITE_PUBLICATION_AWAITING_VERIFICATION' || !workflow.sitePublicationAttempt) {
    throw new Error('A site verification request requires a persisted publication attempt');
  }
  return Object.freeze({
    workflowId: workflow.id,
    contentId: workflow.contentId,
    ...workflow.sitePublicationAttempt,
  });
}

export function buildLinkedInShareVerificationRequest(
  workflow: PublicationWorkflow,
): LinkedInShareVerificationRequest {
  if (
    workflow.stage !== 'LINKEDIN_SHARE_AWAITING_VERIFICATION'
    || !workflow.linkedInShareAttempt
    || !workflow.sitePublication
    || !workflow.linkedInConnection
    || !workflow.linkedInApproval
  ) {
    throw new Error('A LinkedIn verification request requires a persisted share attempt');
  }
  return Object.freeze({
    workflowId: workflow.id,
    contentId: workflow.contentId,
    connectionReference: workflow.linkedInConnection.reference,
    publicationUrl: workflow.sitePublication.publicationUrl,
    commentary: workflow.linkedInApproval.commentary,
    authorUrn: workflow.linkedInApproval.authorUrn,
    approvedBy: workflow.linkedInApproval.approvedBy,
    approvedAt: workflow.linkedInApproval.approvedAt,
    ...workflow.linkedInShareAttempt,
  });
}

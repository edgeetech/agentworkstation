import {
  assertNotSecretLike,
  createLinkedInConnectionReference,
  createPublicationSiteTarget,
  type LinkedInConnectionReference,
  type PublicationSiteTarget,
} from './configuration';

export type PublicationStage =
  | 'SITE_APPROVAL_PENDING'
  | 'SITE_APPROVED'
  | 'SITE_PUBLICATION_AWAITING_VERIFICATION'
  | 'SITE_PUBLISHED_VERIFIED'
  | 'LINKEDIN_APPROVAL_PENDING'
  | 'LINKEDIN_APPROVED'
  | 'LINKEDIN_SHARE_AWAITING_VERIFICATION'
  | 'LINKEDIN_SHARED_VERIFIED';

export type PublicationAuditAction =
  | 'SITE_APPROVAL_REQUESTED'
  | 'SITE_PUBLICATION_APPROVED'
  | 'SITE_PUBLICATION_EXECUTED'
  | 'SITE_PUBLICATION_VERIFIED'
  | 'LINKEDIN_APPROVAL_REQUESTED'
  | 'LINKEDIN_SHARE_APPROVED'
  | 'LINKEDIN_SHARE_EXECUTED'
  | 'LINKEDIN_SHARE_VERIFIED';

export type AuditIdentity = Readonly<{
  actorLabel: string;
  at: string;
}>;

export type PublicationAuditEntry = Readonly<AuditIdentity & {
  action: PublicationAuditAction;
}>;

export type ApprovalRecord = Readonly<{
  approvedBy: string;
  approvedAt: string;
}>;

export type LinkedInShareApprovalRequest = Readonly<{
  commentary: string;
  publicationUrl: string;
  authorUrn: string;
  memberSubject: string;
  memberDisplayName?: string;
}>;

export type LinkedInShareApproval = Readonly<LinkedInShareApprovalRequest & ApprovalRecord>;

export type PublicationArtifactRole =
  | 'primary-article'
  | 'translation'
  | 'visual-asset'
  | 'other-asset';

export type PublicationArtifact = Readonly<{
  path: string;
  sha256: string;
  role: PublicationArtifactRole;
}>;

export type PublicationBundle = Readonly<{
  contentId: string;
  primaryArticlePath: string;
  artifacts: readonly PublicationArtifact[];
}>;

export type SitePublicationAttempt = Readonly<{
  publicationUrl: string;
  publisherReference: string;
  executedAt: string;
  executedBy: string;
}>;

export type VerifiedSitePublication = Readonly<SitePublicationAttempt & {
  verifiedAt: string;
  verifiedBy: string;
}>;

export type LinkedInShareAttempt = Readonly<{
  shareUrl?: string;
  publisherReference: string;
  executedAt: string;
  executedBy: string;
}>;

export type VerifiedLinkedInShare = Readonly<LinkedInShareAttempt & {
  verifiedAt: string;
  verifiedBy: string;
}>;

export type PublicationWorkflow = Readonly<{
  id: string;
  contentId: string;
  bundle: PublicationBundle;
  target: PublicationSiteTarget;
  linkedInConnection?: LinkedInConnectionReference;
  stage: PublicationStage;
  siteApproval?: ApprovalRecord;
  sitePublicationAttempt?: SitePublicationAttempt;
  sitePublication?: VerifiedSitePublication;
  linkedInApprovalRequest?: LinkedInShareApprovalRequest;
  linkedInApproval?: LinkedInShareApproval;
  linkedInShareAttempt?: LinkedInShareAttempt;
  linkedInShare?: VerifiedLinkedInShare;
  auditTrail: readonly PublicationAuditEntry[];
}>;

function validateLabel(value: string, label: string, maxLength = 256): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${label} contains control characters`);
  return normalized;
}

const ARTIFACT_ROLES = new Set<PublicationArtifactRole>([
  'primary-article', 'translation', 'visual-asset', 'other-asset',
]);

function validateRelativeArtifactPath(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`${label} must be a non-empty safe relative path`);
  }
  if (/^[A-Za-z]:[\\/]/u.test(normalized) || /^[\\/]/u.test(normalized)) {
    throw new Error(`${label} must be a relative path`);
  }
  const segments = normalized.split(/[\\/]+/u);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain traversal or empty path segments`);
  }
  return segments.join('/');
}

export function createPublicationBundle(input: unknown): PublicationBundle {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('publication bundle must be an object');
  }
  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set(['contentId', 'primaryArticlePath', 'artifacts']);
  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown publication bundle key: ${key}`);
  }
  const contentId = validateLabel(
    typeof candidate.contentId === 'string' ? candidate.contentId : '',
    'content id',
    256,
  );
  assertNotSecretLike(contentId, 'content id');
  const primaryArticlePath = validateRelativeArtifactPath(
    candidate.primaryArticlePath,
    'primaryArticlePath',
  );
  if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
    throw new Error('publication bundle requires a non-empty artifact list');
  }
  const artifacts = candidate.artifacts.map((value, index): PublicationArtifact => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`artifacts[${index}] must be an object`);
    }
    const artifact = value as Record<string, unknown>;
    for (const key of Object.keys(artifact)) {
      if (!new Set(['path', 'sha256', 'role']).has(key)) {
        throw new Error(`artifacts[${index}] contains unsupported key ${key}`);
      }
    }
    const artifactPath = validateRelativeArtifactPath(artifact.path, `artifacts[${index}].path`);
    if (typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/iu.test(artifact.sha256)) {
      throw new Error(`artifacts[${index}].sha256 must be a SHA-256 hash`);
    }
    if (typeof artifact.role !== 'string' || !ARTIFACT_ROLES.has(artifact.role as PublicationArtifactRole)) {
      throw new Error(`artifacts[${index}].role is unsupported`);
    }
    return Object.freeze({
      path: artifactPath,
      sha256: artifact.sha256.toLowerCase(),
      role: artifact.role as PublicationArtifactRole,
    });
  });
  if (new Set(artifacts.map(({ path: artifactPath }) => artifactPath)).size !== artifacts.length) {
    throw new Error('publication bundle artifact paths must be unique');
  }
  const primaryArtifacts = artifacts.filter(({ role }) => role === 'primary-article');
  if (primaryArtifacts.length !== 1 || primaryArtifacts[0]?.path !== primaryArticlePath) {
    throw new Error('publication bundle requires exactly one primary article matching primaryArticlePath');
  }
  if (!artifacts.some(({ role }) => role === 'translation')) {
    throw new Error('bilingual publication bundle requires at least one translation');
  }
  return Object.freeze({
    contentId,
    primaryArticlePath,
    artifacts: Object.freeze(artifacts),
  });
}

function validateIdentity(identity: AuditIdentity): AuditIdentity {
  const actorLabel = validateLabel(identity.actorLabel, 'actorLabel', 120);
  const parsed = new Date(identity.at);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== identity.at) {
    throw new Error('Audit timestamp must be an exact UTC ISO-8601 timestamp');
  }
  return Object.freeze({ actorLabel, at: identity.at });
}

function auditEntry(action: PublicationAuditAction, identity: AuditIdentity): PublicationAuditEntry {
  return Object.freeze({ action, ...validateIdentity(identity) });
}

function assertStage(workflow: PublicationWorkflow, expected: PublicationStage, action: string): void {
  if (workflow.stage !== expected) {
    throw new Error(`${action} requires ${expected}; current stage is ${workflow.stage}`);
  }
}

function transition(
  workflow: PublicationWorkflow,
  stage: PublicationStage,
  action: PublicationAuditAction,
  identity: AuditIdentity,
  additions: Partial<PublicationWorkflow> = {},
): PublicationWorkflow {
  const entry = auditEntry(action, identity);
  const previousEntry = workflow.auditTrail.at(-1);
  if (previousEntry && entry.at < previousEntry.at) {
    throw new Error('Audit timestamps must not move backwards');
  }
  return Object.freeze({
    ...workflow,
    ...additions,
    stage,
    auditTrail: Object.freeze([...workflow.auditTrail, entry]),
  });
}

function normalizePublicationUrl(value: string, workflow: PublicationWorkflow): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Verified publication URL must be an absolute HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== workflow.target.displayDomain
    || parsed.username
    || parsed.password
  ) {
    throw new Error('Verified publication URL must be a credential-free HTTPS URL on displayDomain');
  }
  const normalized = parsed.toString();
  if (workflow.target.publicBaseUrl) {
    const base = `${workflow.target.publicBaseUrl.replace(/\/$/, '')}/`;
    if (normalized !== workflow.target.publicBaseUrl && !normalized.startsWith(base)) {
      throw new Error('Verified publication URL must be within publicBaseUrl');
    }
  }
  return normalized;
}

function normalizeLinkedInShareUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('LinkedIn share URL must be an absolute HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:'
    || !/(^|\.)linkedin\.com$/i.test(parsed.hostname)
    || parsed.username
    || parsed.password
  ) {
    throw new Error('LinkedIn share URL must be a credential-free LinkedIn HTTPS URL');
  }
  return parsed.toString();
}

function validateLinkedInCommentary(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('LinkedIn commentary is required');
  if (value.length > 3_000) throw new Error('LinkedIn commentary exceeds 3000 characters');
  if (/\u0000|\u000b|\u000c|\u007f/u.test(value)) {
    throw new Error('LinkedIn commentary contains unsupported control characters');
  }
  return value;
}

function validateLinkedInApprovalRequest(
  workflow: PublicationWorkflow,
  input: LinkedInShareApprovalRequest,
): LinkedInShareApprovalRequest {
  if (!workflow.sitePublication) throw new Error('LinkedIn approval requires verified site publication');
  const publicationUrl = normalizePublicationUrl(input.publicationUrl, workflow);
  if (publicationUrl !== workflow.sitePublication.publicationUrl) {
    throw new Error('LinkedIn approval must bind the exact verified publication URL');
  }
  const authorUrn = validateLabel(input.authorUrn, 'LinkedIn author URN', 256);
  if (!/^urn:li:person:[A-Za-z0-9_-]+$/u.test(authorUrn)) {
    throw new Error('LinkedIn author URN must identify an authenticated member');
  }
  const memberSubject = validateLabel(input.memberSubject, 'LinkedIn member subject', 256);
  const memberDisplayName = input.memberDisplayName === undefined
    ? undefined
    : validateLabel(input.memberDisplayName, 'LinkedIn member display name', 256);
  return Object.freeze({
    commentary: validateLinkedInCommentary(input.commentary),
    publicationUrl,
    authorUrn,
    memberSubject,
    ...(memberDisplayName === undefined ? {} : { memberDisplayName }),
  });
}

export function createPublicationWorkflow(input: {
  id: string;
  bundle: PublicationBundle;
  target: PublicationSiteTarget;
  linkedInConnection?: LinkedInConnectionReference;
  requestedBy: AuditIdentity;
}): PublicationWorkflow {
  const bundle = createPublicationBundle(input.bundle);
  const workflow: PublicationWorkflow = {
    id: validateLabel(input.id, 'workflow id', 128),
    contentId: bundle.contentId,
    bundle,
    target: createPublicationSiteTarget(input.target),
    ...(input.linkedInConnection
      ? { linkedInConnection: createLinkedInConnectionReference(input.linkedInConnection.reference) }
      : {}),
    stage: 'SITE_APPROVAL_PENDING',
    auditTrail: Object.freeze([auditEntry('SITE_APPROVAL_REQUESTED', input.requestedBy)]),
  };
  return Object.freeze(workflow);
}

export function approveSitePublication(
  workflow: PublicationWorkflow,
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'SITE_APPROVAL_PENDING', 'Site publication approval');
  const approved = validateIdentity(identity);
  return transition(workflow, 'SITE_APPROVED', 'SITE_PUBLICATION_APPROVED', approved, {
    siteApproval: Object.freeze({ approvedBy: approved.actorLabel, approvedAt: approved.at }),
  });
}

export function recordSitePublicationExecution(
  workflow: PublicationWorkflow,
  result: { publicationUrl: string; publisherReference: string },
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'SITE_APPROVED', 'Site publication execution');
  const executed = validateIdentity(identity);
  const sitePublicationAttempt: SitePublicationAttempt = Object.freeze({
    publicationUrl: normalizePublicationUrl(result.publicationUrl, workflow),
    publisherReference: validateLabel(result.publisherReference, 'site publisher reference'),
    executedAt: executed.at,
    executedBy: executed.actorLabel,
  });
  assertNotSecretLike(sitePublicationAttempt.publisherReference, 'site publisher reference');
  return transition(
    workflow,
    'SITE_PUBLICATION_AWAITING_VERIFICATION',
    'SITE_PUBLICATION_EXECUTED',
    executed,
    { sitePublicationAttempt },
  );
}

export function verifySitePublication(
  workflow: PublicationWorkflow,
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'SITE_PUBLICATION_AWAITING_VERIFICATION', 'Site publication verification');
  if (!workflow.sitePublicationAttempt) {
    throw new Error('Site publication verification requires a persisted publication attempt');
  }
  const verified = validateIdentity(identity);
  const sitePublication: VerifiedSitePublication = Object.freeze({
    ...workflow.sitePublicationAttempt,
    verifiedAt: verified.at,
    verifiedBy: verified.actorLabel,
  });
  return transition(workflow, 'SITE_PUBLISHED_VERIFIED', 'SITE_PUBLICATION_VERIFIED', verified, {
    sitePublication,
  });
}

export function requestLinkedInApproval(
  workflow: PublicationWorkflow,
  request: LinkedInShareApprovalRequest,
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'SITE_PUBLISHED_VERIFIED', 'LinkedIn approval request');
  const validatedRequest = validateLinkedInApprovalRequest(workflow, request);
  return transition(workflow, 'LINKEDIN_APPROVAL_PENDING', 'LINKEDIN_APPROVAL_REQUESTED', identity, {
    linkedInConnection: createLinkedInConnectionReference(`linkedin:oidc:${validatedRequest.memberSubject}`),
    linkedInApprovalRequest: validatedRequest,
  });
}

export function approveLinkedInShare(
  workflow: PublicationWorkflow,
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'LINKEDIN_APPROVAL_PENDING', 'LinkedIn sharing approval');
  if (!workflow.sitePublication || !workflow.linkedInConnection || !workflow.linkedInApprovalRequest) {
    throw new Error('LinkedIn sharing approval requires verified site publication, connection, and exact social copy');
  }
  const approved = validateIdentity(identity);
  return transition(workflow, 'LINKEDIN_APPROVED', 'LINKEDIN_SHARE_APPROVED', approved, {
    linkedInApproval: Object.freeze({
      ...workflow.linkedInApprovalRequest,
      approvedBy: approved.actorLabel,
      approvedAt: approved.at,
    }),
  });
}

export function recordLinkedInShareExecution(
  workflow: PublicationWorkflow,
  result: { publisherReference: string; shareUrl?: string },
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'LINKEDIN_APPROVED', 'LinkedIn share execution');
  if (!workflow.sitePublication || !workflow.linkedInConnection || !workflow.linkedInApproval) {
    throw new Error('LinkedIn share execution requires verified site publication, connection, and approval');
  }
  const executed = validateIdentity(identity);
  const linkedInShareAttempt: LinkedInShareAttempt = Object.freeze({
    publisherReference: validateLabel(result.publisherReference, 'LinkedIn publisher reference'),
    ...(result.shareUrl === undefined ? {} : { shareUrl: normalizeLinkedInShareUrl(result.shareUrl) }),
    executedAt: executed.at,
    executedBy: executed.actorLabel,
  });
  assertNotSecretLike(linkedInShareAttempt.publisherReference, 'LinkedIn publisher reference');
  return transition(
    workflow,
    'LINKEDIN_SHARE_AWAITING_VERIFICATION',
    'LINKEDIN_SHARE_EXECUTED',
    executed,
    { linkedInShareAttempt },
  );
}

export function verifyLinkedInShare(
  workflow: PublicationWorkflow,
  identity: AuditIdentity,
): PublicationWorkflow {
  assertStage(workflow, 'LINKEDIN_SHARE_AWAITING_VERIFICATION', 'LinkedIn share verification');
  if (!workflow.linkedInShareAttempt) {
    throw new Error('LinkedIn share verification requires a persisted share attempt');
  }
  const verified = validateIdentity(identity);
  const linkedInShare: VerifiedLinkedInShare = Object.freeze({
    ...workflow.linkedInShareAttempt,
    verifiedAt: verified.at,
    verifiedBy: verified.actorLabel,
  });
  return transition(workflow, 'LINKEDIN_SHARED_VERIFIED', 'LINKEDIN_SHARE_VERIFIED', verified, {
    linkedInShare,
  });
}

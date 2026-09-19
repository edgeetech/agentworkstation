import {
  assertNotSecretLike,
  createLinkedInConnectionReference,
  createLinkedInPublisherConfiguration,
  createPublicationSiteTarget,
  type LinkedInConnectionReference,
  type LinkedInPublisherConfiguration,
  type PublicationSiteTarget,
} from '../../domain/publication/configuration';
import {
  approveLinkedInShare,
  approveSitePublication,
  createPublicationBundle,
  createPublicationWorkflow,
  recordLinkedInShareExecution,
  recordSitePublicationExecution,
  requestLinkedInApproval,
  verifyLinkedInShare,
  verifySitePublication,
  type AuditIdentity,
  type PublicationAuditAction,
  type PublicationWorkflow,
} from '../../domain/publication/workflow';

export interface PublicationSettingStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface PublicationPersistence {
  getSiteTarget(): Promise<PublicationSiteTarget | null>;
  saveSiteTarget(target: PublicationSiteTarget): Promise<void>;
  clearSiteTarget(): Promise<void>;
  getLinkedInConnectionReference(): Promise<LinkedInConnectionReference | null>;
  saveLinkedInConnectionReference(reference: LinkedInConnectionReference): Promise<void>;
  clearLinkedInConnectionReference(): Promise<void>;
  getActiveWorkflow(): Promise<PublicationWorkflow | null>;
  saveActiveWorkflow(workflow: PublicationWorkflow): Promise<void>;
  getWorkflowHistory(): Promise<readonly PublicationWorkflow[]>;
  archiveActiveWorkflow(workflow: PublicationWorkflow): Promise<void>;
}

export const COMPLETED_PUBLICATION_STAGES = new Set([
  'SITE_PUBLISHED_VERIFIED',
  'LINKEDIN_SHARED_VERIFIED',
]);

export function assertArchivablePublicationWorkflow(workflow: PublicationWorkflow): void {
  if (!COMPLETED_PUBLICATION_STAGES.has(workflow.stage)) {
    throw new Error(`Publication workflow ${workflow.id} cannot be archived while ${workflow.stage}`);
  }
}

export class PublicationPersistenceDiagnostic extends Error {
  readonly code = 'MALFORMED_PERSISTED_PUBLICATION_STATE';
  readonly recoverable = true;

  constructor(readonly key: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PublicationPersistenceDiagnostic';
  }
}

const WORKFLOW_KEYS = new Set([
  'id',
  'contentId',
  'bundle',
  'target',
  'linkedInConnection',
  'stage',
  'siteApproval',
  'sitePublicationAttempt',
  'sitePublication',
  'linkedInApprovalRequest',
  'linkedInApproval',
  'linkedInShareAttempt',
  'linkedInShare',
  'auditTrail',
]);
const AUDIT_ENTRY_KEYS = new Set(['action', 'actorLabel', 'at']);
const SECRET_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?(?:key|token)|auth|bearer|cookie|credential|password|private[_-]?key|secret|token)(?:$|[_-])|(?:apiKey|apiToken|accessToken|privateKey)/i;

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported key ${key}`);
  }
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => structurallyEqual(entry, right[index]));
  }
  if (
    typeof left !== 'object'
    || left === null
    || typeof right !== 'object'
    || right === null
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(rightRecord, key)
      && structurallyEqual(leftRecord[key], rightRecord[key]));
}

function assertPersistableNonSecret(value: unknown, label: string): void {
  if (typeof value === 'string') {
    assertNotSecretLike(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertPersistableNonSecret(entry, label));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${label} contains a secret-like key`);
    assertPersistableNonSecret(entry, `${label}.${key}`);
  }
}

function parseAuditEntry(value: unknown): { action: PublicationAuditAction; identity: AuditIdentity } {
  const entry = requireObject(value, 'Publication audit entry');
  rejectUnknownKeys(entry, AUDIT_ENTRY_KEYS, 'Publication audit entry');
  return {
    action: requireString(entry.action, 'Publication audit action') as PublicationAuditAction,
    identity: {
      actorLabel: requireString(entry.actorLabel, 'Publication audit actor'),
      at: requireString(entry.at, 'Publication audit timestamp'),
    },
  };
}

export function validatePublicationSiteTarget(value: unknown): PublicationSiteTarget {
  assertPersistableNonSecret(value, 'Publication site target');
  return createPublicationSiteTarget(value);
}

export function validateLinkedInConnectionReference(value: unknown): LinkedInConnectionReference {
  const candidate = requireObject(value, 'LinkedIn connection reference');
  rejectUnknownKeys(candidate, new Set(['reference']), 'LinkedIn connection reference');
  assertPersistableNonSecret(candidate, 'LinkedIn connection reference');
  return createLinkedInConnectionReference(candidate.reference);
}

export function validateLinkedInPublisherConfiguration(value: unknown): LinkedInPublisherConfiguration {
  const candidate = requireObject(value, 'LinkedIn publisher configuration');
  rejectUnknownKeys(candidate, new Set(['clientId', 'apiVersion']), 'LinkedIn publisher configuration');
  return createLinkedInPublisherConfiguration(candidate);
}

export function validatePublicationWorkflow(value: unknown): PublicationWorkflow {
  const candidate = requireObject(value, 'Publication workflow');
  rejectUnknownKeys(candidate, WORKFLOW_KEYS, 'Publication workflow');
  assertPersistableNonSecret(candidate, 'Publication workflow');

  if (!Array.isArray(candidate.auditTrail) || candidate.auditTrail.length === 0) {
    throw new Error('Publication workflow requires an audit trail');
  }
  const entries = candidate.auditTrail.map(parseAuditEntry);
  if (entries[0].action !== 'SITE_APPROVAL_REQUESTED') {
    throw new Error('Publication workflow must begin with a site approval request');
  }

  let workflow = createPublicationWorkflow({
    id: requireString(candidate.id, 'Publication workflow id'),
    bundle: createPublicationBundle(candidate.bundle),
    target: validatePublicationSiteTarget(candidate.target),
    ...(candidate.linkedInConnection === undefined
      ? {}
      : { linkedInConnection: validateLinkedInConnectionReference(candidate.linkedInConnection) }),
    requestedBy: entries[0].identity,
  });

  for (const entry of entries.slice(1)) {
    switch (entry.action) {
      case 'SITE_PUBLICATION_APPROVED':
        workflow = approveSitePublication(workflow, entry.identity);
        break;
      case 'SITE_PUBLICATION_EXECUTED': {
        const attempt = requireObject(candidate.sitePublicationAttempt, 'Site publication attempt');
        workflow = recordSitePublicationExecution(workflow, {
          publicationUrl: requireString(attempt.publicationUrl, 'Publication URL'),
          publisherReference: requireString(attempt.publisherReference, 'Site publisher reference'),
        }, entry.identity);
        break;
      }
      case 'SITE_PUBLICATION_VERIFIED': {
        workflow = verifySitePublication(workflow, entry.identity);
        break;
      }
      case 'LINKEDIN_APPROVAL_REQUESTED':
        {
          const request = requireObject(candidate.linkedInApprovalRequest, 'LinkedIn approval request');
          workflow = requestLinkedInApproval(workflow, {
            commentary: requireString(request.commentary, 'LinkedIn commentary'),
            publicationUrl: requireString(request.publicationUrl, 'LinkedIn publication URL'),
            authorUrn: requireString(request.authorUrn, 'LinkedIn author URN'),
            memberSubject: requireString(request.memberSubject, 'LinkedIn member subject'),
            ...(request.memberDisplayName === undefined
              ? {}
              : { memberDisplayName: requireString(request.memberDisplayName, 'LinkedIn member display name') }),
          }, entry.identity);
        }
        break;
      case 'LINKEDIN_SHARE_APPROVED':
        workflow = approveLinkedInShare(workflow, entry.identity);
        break;
      case 'LINKEDIN_SHARE_EXECUTED': {
        const attempt = requireObject(candidate.linkedInShareAttempt, 'LinkedIn share attempt');
        const shareUrl = attempt.shareUrl;
        if (shareUrl !== undefined && typeof shareUrl !== 'string') {
          throw new Error('LinkedIn share URL must be a string');
        }
        workflow = recordLinkedInShareExecution(workflow, {
          publisherReference: requireString(attempt.publisherReference, 'LinkedIn publisher reference'),
          ...(shareUrl === undefined ? {} : { shareUrl }),
        }, entry.identity);
        break;
      }
      case 'LINKEDIN_SHARE_VERIFIED': {
        workflow = verifyLinkedInShare(workflow, entry.identity);
        break;
      }
      default:
        throw new Error(`Unsupported publication audit action ${entry.action}`);
    }
  }

  if (!structurallyEqual(workflow, candidate)) {
    throw new Error('Publication workflow does not match its validated audit trail');
  }
  return workflow;
}

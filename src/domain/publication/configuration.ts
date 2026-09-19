const SITE_TARGET_KEYS = new Set([
  'displayDomain',
  'workspaceId',
  'contentDirectory',
  'publishBranch',
  'approvedAssetDirectories',
  'publicBaseUrl',
]);

const SECRET_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|auth|bearer|cookie|credential|password|private[_-]?key|secret|token)(?:$|[_-])/i;
const SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/i,
  /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/i,
  /\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
];

export type PublicationSiteTarget = Readonly<{
  displayDomain: string;
  workspaceId: string;
  contentDirectory: string;
  publishBranch: string;
  approvedAssetDirectories?: readonly string[];
  publicBaseUrl?: string;
}>;

export type LinkedInConnectionReference = Readonly<{
  reference: string;
}>;

export type LinkedInPublisherConfiguration = Readonly<{
  clientId: string;
  apiVersion: string;
}>;

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength = 256): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${label} contains control characters`);
  return normalized;
}

export function assertNotSecretLike(value: string, label: string): void {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${label} must be a non-secret reference or public value; credentials are not allowed`);
  }
}

function normalizeDisplayDomain(value: unknown): string {
  const domain = requireString(value, 'displayDomain', 253).toLowerCase();
  if (domain.includes('://') || /[/?#@]/.test(domain)) {
    throw new Error('displayDomain must be a hostname without a scheme, path, or credentials');
  }

  let parsed: URL;
  try {
    parsed = new URL(`https://${domain}`);
  } catch {
    throw new Error('displayDomain must be a valid hostname');
  }
  if (parsed.hostname !== domain || parsed.port || !domain.includes('.')) {
    throw new Error('displayDomain must be a valid public hostname');
  }
  return domain;
}

function normalizeRelativeDirectory(value: unknown, label = 'contentDirectory'): string {
  const directory = requireString(value, label, 512);
  if (
    /^[A-Za-z]:[\\/]/.test(directory)
    || /^[\\/]{1,2}/.test(directory)
    || directory.includes('\0')
  ) {
    throw new Error(`${label} must be a relative directory`);
  }

  const segments = directory.split(/[\\/]+/);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain traversal or empty path segments`);
  }
  return segments.join('/');
}

function normalizePublishBranch(value: unknown): string {
  const branch = requireString(value, 'publishBranch', 128);
  const segments = branch.split('/');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch)
    || branch.includes('..')
    || branch.includes('//')
    || branch.includes('@{')
    || branch.endsWith('.')
    || branch.endsWith('/')
    || segments.some((segment) =>
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment) || segment.endsWith('.lock'))
  ) {
    throw new Error('publishBranch must be a conservative Git branch name');
  }
  return branch;
}

function normalizeApprovedAssetDirectories(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('approvedAssetDirectories must be an array');
  const directories = value.map((entry, index) =>
    normalizeRelativeDirectory(entry, `approvedAssetDirectories[${index}]`));
  if (new Set(directories).size !== directories.length) {
    throw new Error('approvedAssetDirectories must be unique');
  }
  return Object.freeze(directories);
}

function normalizePublicBaseUrl(value: unknown, displayDomain: string): string {
  const raw = requireString(value, 'publicBaseUrl', 2_048);
  assertNotSecretLike(raw, 'publicBaseUrl');

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('publicBaseUrl must be an absolute HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname.toLowerCase() !== displayDomain
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('publicBaseUrl must be an HTTPS URL on displayDomain without credentials, query, or fragment');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function createPublicationSiteTarget(input: unknown): PublicationSiteTarget {
  const candidate = requirePlainObject(input, 'site target');
  for (const key of Object.keys(candidate)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Secret-like configuration key is not allowed: ${key}`);
    }
    if (!SITE_TARGET_KEYS.has(key)) throw new Error(`Unknown site target configuration key: ${key}`);
  }

  const displayDomain = normalizeDisplayDomain(candidate.displayDomain);
  const workspaceId = requireString(candidate.workspaceId, 'workspaceId', 128);
  assertNotSecretLike(workspaceId, 'workspaceId');
  const contentDirectory = normalizeRelativeDirectory(candidate.contentDirectory);
  assertNotSecretLike(contentDirectory, 'contentDirectory');
  const publishBranch = normalizePublishBranch(candidate.publishBranch);
  const approvedAssetDirectories = normalizeApprovedAssetDirectories(candidate.approvedAssetDirectories);

  const target: PublicationSiteTarget = {
    displayDomain,
    workspaceId,
    contentDirectory,
    publishBranch,
    ...(approvedAssetDirectories === undefined ? {} : { approvedAssetDirectories }),
    ...(candidate.publicBaseUrl === undefined
      ? {}
      : { publicBaseUrl: normalizePublicBaseUrl(candidate.publicBaseUrl, displayDomain) }),
  };
  return Object.freeze(target);
}

export function createLinkedInConnectionReference(value: unknown): LinkedInConnectionReference {
  const reference = requireString(value, 'LinkedIn connection reference', 256);
  assertNotSecretLike(reference, 'LinkedIn connection reference');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(reference)) {
    throw new Error('LinkedIn connection reference contains unsupported characters');
  }
  return Object.freeze({ reference });
}

export function createLinkedInPublisherConfiguration(value: unknown): LinkedInPublisherConfiguration {
  const candidate = requirePlainObject(value, 'LinkedIn publisher configuration');
  for (const key of Object.keys(candidate)) {
    if (!new Set(['clientId', 'apiVersion']).has(key)) {
      throw new Error(`Unknown LinkedIn publisher configuration key: ${key}`);
    }
  }
  const clientId = requireString(candidate.clientId, 'LinkedIn client ID', 256);
  if (!/^[A-Za-z0-9_-]+$/u.test(clientId)) throw new Error('LinkedIn client ID contains unsupported characters');
  const apiVersion = requireString(candidate.apiVersion, 'LinkedIn API version', 6);
  if (!/^\d{6}$/u.test(apiVersion)) throw new Error('LinkedIn API version must use YYYYMM');
  const month = Number(apiVersion.slice(4));
  if (month < 1 || month > 12) throw new Error('LinkedIn API version month is invalid');
  return Object.freeze({ clientId, apiVersion });
}

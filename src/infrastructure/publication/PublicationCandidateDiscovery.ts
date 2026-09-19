import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse } from 'yaml';
import type { WorkspaceGateway } from '../../application/ports';
import type { PendingAction } from '../../domain/actions';
import type { PublicationSiteTarget } from '../../domain/publication/configuration';
import type { ChatSession } from '../../domain/sessions';

export type PublicationCandidateLanguage = 'tr' | 'en';

export type PublicationArticlePreview = Readonly<{
  language: PublicationCandidateLanguage;
  title: string;
  description?: string;
  path: string;
  preview: string;
  byteLength: number;
}>;

export type PublicationVisualPreview = Readonly<{
  path: string;
  name: string;
  format: string;
  byteLength: number;
  width?: string;
  height?: string;
  altText?: string;
}>;

export type PublicationCandidate = Readonly<{
  id: string;
  contentId: string;
  label: string;
  sessionId: string;
  sessionName: string;
  workspaceId: string;
  updatedAt: string;
  recommendedPrimaryLanguage: PublicationCandidateLanguage;
  articles: Readonly<Record<PublicationCandidateLanguage, PublicationArticlePreview>>;
  visuals: readonly PublicationVisualPreview[];
  artifactHashes: Readonly<Record<string, string>>;
}>;

type ArticleRecord = {
  action: PendingAction;
  language: PublicationCandidateLanguage;
  title: string;
  description?: string;
  slug?: string;
  stem: string;
  preview: string;
  byteLength: number;
  primary: boolean;
};

type VisualRecord = {
  action: PendingAction;
  stem: string;
  preview: PublicationVisualPreview;
};

const COHERENCE_WINDOW_MS = 2 * 60 * 60 * 1_000;
const ARTICLE_PREVIEW_LIMIT = 8_000;
const ARTICLE_EXTENSIONS = new Set(['.md', '.mdx']);
const VISUAL_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

function normalizeRelativePath(value: string): string | null {
  const normalized = value.trim().replaceAll('\\', '/');
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function isInside(relativePath: string, directory: string): boolean {
  const normalizedDirectory = normalizeRelativePath(directory)?.replace(/\/$/u, '');
  return Boolean(normalizedDirectory)
    && (relativePath === normalizedDirectory || relativePath.startsWith(`${normalizedDirectory}/`));
}

function normalizeLanguage(value: unknown): PublicationCandidateLanguage | null {
  if (typeof value !== 'string') return null;
  const language = value.trim().toLowerCase().replace('_', '-');
  if (language === 'tr' || language.startsWith('tr-')) return 'tr';
  if (language === 'en' || language.startsWith('en-')) return 'en';
  return null;
}

function filenameLanguage(relativePath: string): PublicationCandidateLanguage | null {
  const withoutExtension = path.posix.basename(relativePath, path.posix.extname(relativePath)).toLowerCase();
  const marker = withoutExtension.match(/(?:^|[._-])(tr|en)(?:$|[._-])/u)?.[1];
  if (marker === 'tr' || marker === 'en') return marker;
  const directoryMarker = relativePath.toLowerCase().split('/').find((part) => part === 'tr' || part === 'en');
  return directoryMarker === 'tr' || directoryMarker === 'en' ? directoryMarker : null;
}

function articleStem(relativePath: string): string {
  const extension = path.posix.extname(relativePath);
  const basename = path.posix.basename(relativePath, extension)
    .replace(/(?:^|[._-])(tr|en)(?=$|[._-])/giu, '')
    .replace(/[._-]+$/u, '');
  return `${path.posix.dirname(relativePath)}/${basename}`.replace(/^\.\//u, '').toLowerCase();
}

function frontmatter(content: string): { data: Record<string, unknown>; body: string } {
  if (!content.startsWith('---')) return { data: {}, body: content };
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/u);
  if (!match) return { data: {}, body: content };
  try {
    const data = parse(match[1]);
    return {
      data: typeof data === 'object' && data !== null && !Array.isArray(data)
        ? data as Record<string, unknown>
        : {},
      body: content.slice(match[0].length),
    };
  } catch {
    return { data: {}, body: content };
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function titleFromBody(body: string, relativePath: string): string {
  const heading = body.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  if (heading) return heading;
  return path.posix.basename(relativePath, path.posix.extname(relativePath))
    .replace(/[._-]+/gu, ' ')
    .replace(/\b\w/gu, (value) => value.toUpperCase());
}

function timestamp(action: PendingAction): number {
  const value = Date.parse(action.decidedAt ?? action.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function safeContentId(value: string): string {
  const normalized = value.trim().toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 180);
  return normalized || 'blogger-publication';
}

function svgMetadata(content: string): Pick<PublicationVisualPreview, 'width' | 'height' | 'altText'> {
  const opening = content.match(/<svg\b([^>]*)>/iu)?.[1] ?? '';
  const attribute = (name: string) => opening.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'iu'))?.[1];
  const title = content.match(/<title(?:\s[^>]*)?>([^<]{1,500})<\/title>/iu)?.[1]?.trim();
  const viewBox = attribute('viewBox')?.trim().split(/\s+/u);
  return {
    ...(attribute('width') ? { width: attribute('width') } : viewBox?.length === 4 ? { width: viewBox[2] } : {}),
    ...(attribute('height') ? { height: attribute('height') } : viewBox?.length === 4 ? { height: viewBox[3] } : {}),
    ...(title ? { altText: title } : {}),
  };
}

function candidateId(actions: readonly PendingAction[]): string {
  return createHash('sha256').update(actions.map((action) => action.id).sort().join('\n')).digest('hex');
}

function createCandidate(
  en: ArticleRecord,
  tr: ArticleRecord,
  visuals: readonly VisualRecord[],
  session: ChatSession,
): PublicationCandidate {
  const actions = [en.action, tr.action, ...visuals.map((visual) => visual.action)];
  const updatedAt = actions.map((action) => action.decidedAt ?? action.createdAt).sort().at(-1) ?? session.updatedAt;
  const preferred = en.primary === tr.primary
    ? (timestamp(en.action) <= timestamp(tr.action) ? en.language : tr.language)
    : en.primary ? en.language : tr.language;
  const contentId = safeContentId(en.slug ?? tr.slug ?? path.posix.basename(en.stem));
  return Object.freeze({
    id: candidateId(actions),
    contentId,
    label: en.title === tr.title ? en.title : `${tr.title} / ${en.title}`,
    sessionId: session.id,
    sessionName: session.name,
    workspaceId: en.action.workspaceId,
    updatedAt,
    recommendedPrimaryLanguage: preferred,
    articles: Object.freeze({
      en: Object.freeze({
        language: 'en', title: en.title, ...(en.description ? { description: en.description } : {}),
        path: en.action.targetPath, preview: en.preview, byteLength: en.byteLength,
      }),
      tr: Object.freeze({
        language: 'tr', title: tr.title, ...(tr.description ? { description: tr.description } : {}),
        path: tr.action.targetPath, preview: tr.preview, byteLength: tr.byteLength,
      }),
    }),
    visuals: Object.freeze(visuals.map((visual) => visual.preview)),
    artifactHashes: Object.freeze(Object.fromEntries(actions.map((action) => [
      action.targetPath,
      createHash('sha256').update(Buffer.from(action.proposedContent, 'utf8')).digest('hex'),
    ]))),
  });
}

export async function discoverPublicationCandidates(input: Readonly<{
  actions: readonly PendingAction[];
  sessions: readonly ChatSession[];
  target: PublicationSiteTarget;
  workspaceGateway: WorkspaceGateway;
}>): Promise<PublicationCandidate[]> {
  const sessions = new Map(input.sessions
    .filter((session) => session.agentId === 'blogger' && session.workspaceId === input.target.workspaceId)
    .map((session) => [session.id, session]));
  const newestByPath = new Map<string, PendingAction>();
  for (const action of [...input.actions].sort((left, right) => timestamp(right) - timestamp(left))) {
    if (action.status !== 'EXECUTED' || !sessions.has(action.sessionId)
      || action.workspaceId !== input.target.workspaceId) continue;
    const relativePath = normalizeRelativePath(action.targetPath);
    if (!relativePath) continue;
    const key = `${action.workspaceId}:${relativePath.toLowerCase()}`;
    if (!newestByPath.has(key)) newestByPath.set(key, { ...action, targetPath: relativePath });
  }

  const articles: ArticleRecord[] = [];
  const visuals: VisualRecord[] = [];
  for (const action of newestByPath.values()) {
    let file: { content: string; source: string } | null;
    try {
      file = await input.workspaceGateway.readFileIfExists(action.workspaceId, action.targetPath);
    } catch {
      // Unsafe, oversized, unreadable, or non-text proposals are not publication candidates.
      continue;
    }
    if (!file || file.content !== action.proposedContent) continue;
    const extension = path.posix.extname(action.targetPath).toLowerCase();
    if (ARTICLE_EXTENSIONS.has(extension) && isInside(action.targetPath, input.target.contentDirectory)) {
      const parsed = frontmatter(file.content);
      const language = normalizeLanguage(parsed.data.language ?? parsed.data.lang ?? parsed.data.locale)
        ?? filenameLanguage(action.targetPath);
      if (!language) continue;
      articles.push({
        action,
        language,
        title: text(parsed.data.title) ?? titleFromBody(parsed.body, action.targetPath),
        ...(text(parsed.data.description) ? { description: text(parsed.data.description) } : {}),
        ...(text(parsed.data.slug) ? { slug: text(parsed.data.slug) } : {}),
        stem: articleStem(action.targetPath),
        preview: parsed.body.trim().slice(0, ARTICLE_PREVIEW_LIMIT),
        byteLength: Buffer.byteLength(file.content, 'utf8'),
        primary: parsed.data.primary === true || parsed.data.canonical === true,
      });
      continue;
    }
    if (VISUAL_EXTENSIONS.has(extension)
      && (input.target.approvedAssetDirectories ?? []).some((directory) => isInside(action.targetPath, directory))) {
      const metadata = extension === '.svg' ? svgMetadata(file.content) : {};
      visuals.push({
        action,
        stem: articleStem(action.targetPath),
        preview: Object.freeze({
          path: action.targetPath,
          name: path.posix.basename(action.targetPath),
          format: extension.slice(1).toUpperCase(),
          byteLength: Buffer.byteLength(file.content, 'utf8'),
          ...metadata,
        }),
      });
    }
  }

  const candidates: PublicationCandidate[] = [];
  const usedArticles = new Set<string>();
  const exactGroups = new Map<string, ArticleRecord[]>();
  for (const article of articles) {
    const key = `${article.action.sessionId}:${article.stem}`;
    exactGroups.set(key, [...(exactGroups.get(key) ?? []), article]);
  }
  const addPair = (en: ArticleRecord, tr: ArticleRecord): void => {
    const session = sessions.get(en.action.sessionId);
    if (!session || tr.action.sessionId !== session.id) return;
    const midpoint = Math.max(timestamp(en.action), timestamp(tr.action));
    const recentSessionArticles = articles.filter((article) => article.action.sessionId === session.id
      && Math.abs(timestamp(article.action) - midpoint) <= COHERENCE_WINDOW_MS);
    const hasOneBilingualPair = recentSessionArticles.filter((article) => article.language === 'en').length === 1
      && recentSessionArticles.filter((article) => article.language === 'tr').length === 1;
    const matchingVisuals = visuals.filter((visual) => visual.action.sessionId === session.id
      && Math.abs(timestamp(visual.action) - midpoint) <= COHERENCE_WINDOW_MS
      && (hasOneBilingualPair || visual.stem.includes(path.posix.basename(en.stem))
        || en.stem.includes(path.posix.basename(visual.stem))));
    candidates.push(createCandidate(en, tr, matchingVisuals, session));
    usedArticles.add(en.action.id);
    usedArticles.add(tr.action.id);
  };
  for (const group of exactGroups.values()) {
    const en = group.filter((article) => article.language === 'en').sort((a, b) => timestamp(b.action) - timestamp(a.action));
    const tr = group.filter((article) => article.language === 'tr').sort((a, b) => timestamp(b.action) - timestamp(a.action));
    if (en.length === 1 && tr.length === 1) addPair(en[0], tr[0]);
  }

  const unmatchedBySession = new Map<string, ArticleRecord[]>();
  for (const article of articles.filter((value) => !usedArticles.has(value.action.id))) {
    unmatchedBySession.set(article.action.sessionId, [...(unmatchedBySession.get(article.action.sessionId) ?? []), article]);
  }
  for (const group of unmatchedBySession.values()) {
    const en = group.filter((article) => article.language === 'en');
    const tr = group.filter((article) => article.language === 'tr');
    if (en.length === 1 && tr.length === 1
      && Math.abs(timestamp(en[0].action) - timestamp(tr[0].action)) <= COHERENCE_WINDOW_MS) {
      addPair(en[0], tr[0]);
    }
  }

  return candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20);
}

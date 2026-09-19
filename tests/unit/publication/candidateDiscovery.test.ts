import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PendingAction } from '../../../src/domain/actions';
import type { ChatSession } from '../../../src/domain/sessions';
import { DefaultWorkspaceGateway } from '../../../src/infrastructure/filesystem/workspaceGateway';
import { discoverPublicationCandidates } from '../../../src/infrastructure/publication/PublicationCandidateDiscovery';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'blog-session',
    name: 'Bilingual draft',
    mode: 'autopilot',
    workspaceId: 'site',
    agentId: 'blogger',
    intelligencePreference: 'auto',
    permissionMode: 'interactive',
    isolationMode: 'read_only',
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:05:00.000Z',
    ...overrides,
  };
}

function action(id: string, targetPath: string, proposedContent: string, overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id,
    sessionId: 'blog-session',
    createdAt: '2026-09-10T10:01:00.000Z',
    decidedAt: '2026-09-10T10:02:00.000Z',
    status: 'EXECUTED',
    workspaceId: 'site',
    expectedOriginalHash: 'before',
    proposedContentHash: 'after',
    targetPath,
    proposedContent,
    diff: '',
    ...overrides,
  };
}

function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publication-candidates-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
  return {
    gateway: new DefaultWorkspaceGateway({ site: root }),
    target: {
      displayDomain: 'example.com',
      workspaceId: 'site',
      contentDirectory: 'content',
      publishBranch: 'main',
      approvedAssetDirectories: ['public/images'],
    },
  };
}

describe('approved Blogger publication candidate discovery', () => {
  it('classifies frontmatter languages and attaches a recent original SVG', async () => {
    const english = '---\nlanguage: en-US\ntitle: Practical Agents\nslug: practical-agents\n---\n# Practical Agents\n\nEnglish body.';
    const turkish = '---\nlang: tr\ntitle: Pratik Agentlar\nslug: practical-agents\n---\n# Pratik Agentlar\n\nTürkçe gövde.';
    const visual = '<svg viewBox="0 0 1200 630"><title>Abstract agent workflow</title><rect width="1200" height="630" /></svg>';
    const { gateway, target } = fixture({
      'content/practical-agents.md': english,
      'content/practical-agents.tr.mdx': turkish,
      'public/images/practical-agents.svg': visual,
    });

    const candidates = await discoverPublicationCandidates({
      actions: [
        action('en', 'content/practical-agents.md', english),
        action('tr', 'content/practical-agents.tr.mdx', turkish),
        action('visual', 'public/images/practical-agents.svg', visual),
      ],
      sessions: [session()],
      target,
      workspaceGateway: gateway,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ contentId: 'practical-agents', sessionId: 'blog-session' });
    expect(candidates[0].articles.en.preview).toContain('English body');
    expect(candidates[0].articles.tr.preview).toContain('Türkçe gövde');
    expect(candidates[0].visuals).toEqual([expect.objectContaining({
      name: 'practical-agents.svg', width: '1200', height: '630', altText: 'Abstract agent workflow',
    })]);
  });

  it('uses unambiguous filename language markers as a safe fallback', async () => {
    const english = '# Shared idea\n\nEnglish.';
    const turkish = '# Ortak fikir\n\nTürkçe.';
    const { gateway, target } = fixture({
      'content/shared.en.md': english,
      'content/shared-tr.md': turkish,
    });
    const candidates = await discoverPublicationCandidates({
      actions: [action('en', 'content/shared.en.md', english), action('tr', 'content/shared-tr.md', turkish)],
      sessions: [session()],
      target,
      workspaceGateway: gateway,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].articles.en.path).toBe('content/shared.en.md');
    expect(candidates[0].articles.tr.path).toBe('content/shared-tr.md');
  });

  it('excludes stale files and actions not owned by the bound Blogger session', async () => {
    const english = '---\nlanguage: en\n---\nEnglish.';
    const turkish = '---\nlanguage: tr\n---\nTürkçe.';
    const { gateway, target } = fixture({ 'content/post.md': 'changed after approval', 'content/post.tr.md': turkish });
    const candidates = await discoverPublicationCandidates({
      actions: [
        action('stale', 'content/post.md', english),
        action('career', 'content/post.en.md', english, { sessionId: 'career-session' }),
        action('tr', 'content/post.tr.md', turkish),
      ],
      sessions: [session(), session({ id: 'career-session', agentId: 'career' })],
      target,
      workspaceGateway: gateway,
    });
    expect(candidates).toEqual([]);
  });
});

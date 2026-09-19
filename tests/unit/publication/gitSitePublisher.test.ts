import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SitePublicationRequest } from '../../../src/application/publication/publishers';
import {
  GitSitePublisher,
  NodeGitCommandRunner,
  type GitCommandRunner,
} from '../../../src/infrastructure/publication/GitSitePublisher';
import {
  ExactHttpPublicationVerifier,
  type PublicationHttpClient,
} from '../../../src/infrastructure/publication/HttpPublicationVerifier';

const signal = new AbortController().signal;

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function request(
  repository: string,
  primaryArticlePath: string,
  workspaceId = 'site',
  extraArtifacts: Array<{ path: string; role: 'translation' | 'visual-asset' | 'other-asset' }> = [{
    path: 'content/articles/translation.md', role: 'translation',
  }],
): SitePublicationRequest {
  const artifact = (artifactPath: string, role: 'primary-article' | 'translation' | 'visual-asset' | 'other-asset') => ({
    path: artifactPath,
    sha256: fs.existsSync(path.join(repository, artifactPath))
      ? sha256(path.join(repository, artifactPath))
      : 'a'.repeat(64),
    role,
  });
  return {
    workflowId: 'workflow-1',
    contentId: 'content-package-1',
    bundle: {
      contentId: 'content-package-1',
      primaryArticlePath,
      artifacts: [
        artifact(primaryArticlePath, 'primary-article'),
        ...extraArtifacts.map(({ path: artifactPath, role }) => artifact(artifactPath, role)),
      ],
    },
    approvedBy: 'human-editor',
    approvedAt: '2026-09-10T10:00:00.000Z',
    target: {
      displayDomain: 'example.com',
      workspaceId,
      contentDirectory: 'content/articles',
      publishBranch: 'main',
      ...(extraArtifacts.some(({ role }) => role === 'visual-asset' || role === 'other-asset')
        ? { approvedAssetDirectories: ['public/images'] }
        : {}),
      publicBaseUrl: 'https://example.com/articles',
    },
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepository(): { repository: string; remote: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-'));
  const repository = path.join(parent, 'site');
  const remote = path.join(parent, 'origin.git');
  fs.mkdirSync(repository);
  git(repository, ['init', '-b', 'main']);
  git(repository, ['config', 'user.email', 'publisher@example.com']);
  git(repository, ['config', 'user.name', 'Publication Test']);
  fs.mkdirSync(path.join(repository, 'content', 'articles'), { recursive: true });
  fs.writeFileSync(path.join(repository, 'README.md'), 'initial\n');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'Initial commit']);
  git(parent, ['init', '--bare', remote]);
  git(repository, ['remote', 'add', 'origin', remote]);
  git(repository, ['push', '-u', 'origin', 'main']);
  return { repository, remote };
}

describe('GitSitePublisher', () => {
  it('commits only the exact untracked bilingual bundle, preserves unrelated staging, and pushes the approved branch', async () => {
    const { repository, remote } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'safe-post.md'), '# Safe post\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'safe-post.tr.md'), '# Guvenli yazi\n');
    fs.mkdirSync(path.join(repository, 'public', 'images'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'public', 'images', 'safe-post.png'), 'image bytes');
    fs.writeFileSync(path.join(repository, 'unrelated.txt'), 'must remain staged\n');
    git(repository, ['add', 'unrelated.txt']);

    const calls: string[][] = [];
    const delegate = new NodeGitCommandRunner();
    const runner: GitCommandRunner = {
      async run(cwd, args, abortSignal) {
        calls.push([...args]);
        return delegate.run(cwd, args, abortSignal);
      },
    };
    const publisher = new GitSitePublisher({ getWorkspaceRoot: () => repository }, runner);

    const result = await publisher.publish(request(repository, 'content/articles/safe-post.md', 'site', [
      { path: 'content/articles/safe-post.tr.md', role: 'translation' },
      { path: 'public/images/safe-post.png', role: 'visual-asset' },
    ]), signal);

    expect(result.publicationUrl).toBe('https://example.com/articles/safe-post');
    expect(result.publisherReference).toMatch(/^[0-9a-f]{40}$/u);
    expect(git(repository, ['show', '--pretty=', '--name-only', 'HEAD']).split(/\r?\n/u).sort()).toEqual([
      'content/articles/safe-post.md',
      'content/articles/safe-post.tr.md',
      'public/images/safe-post.png',
    ]);
    expect(git(repository, ['diff', '--cached', '--name-only'])).toBe('unrelated.txt');
    expect(git(remote, ['rev-parse', 'main'])).toBe(result.publisherReference);
    expect(calls).toContainEqual(['push', 'origin', 'HEAD:refs/heads/main']);
    expect(calls.find((args) => args[0] === 'commit')).toEqual([
      'commit', '--only', '-m',
      expect.stringMatching(/^Publish safe-post\.md\n\nPublication-Workflow: workflow-1\nPublication-Bundle: [0-9a-f]{64}$/u),
      '--', 'content/articles/safe-post.md', 'content/articles/safe-post.tr.md',
      'public/images/safe-post.png',
    ]);
  }, 20_000);

  it('retries the push of the exact workflow commit without creating another commit', async () => {
    const { repository, remote } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'retry.md'), '# Retry\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    const delegate = new NodeGitCommandRunner();
    let failPush = true;
    const runner: GitCommandRunner = {
      async run(cwd, args, abortSignal) {
        if (args[0] === 'push' && failPush) {
          failPush = false;
          throw new Error('network unavailable');
        }
        return delegate.run(cwd, args, abortSignal);
      },
    };
    const publisher = new GitSitePublisher({ getWorkspaceRoot: () => repository }, runner);

    const approvedRequest = request(repository, 'content/articles/retry.md');
    await expect(publisher.publish(approvedRequest, signal))
      .rejects.toThrow('network unavailable');
    const localCommit = git(repository, ['rev-parse', 'HEAD']);
    const commitCount = git(repository, ['rev-list', '--count', 'HEAD']);

    const result = await publisher.publish(approvedRequest, signal);

    expect(result.publisherReference).toBe(localCommit);
    expect(git(repository, ['rev-list', '--count', 'HEAD'])).toBe(commitCount);
    expect(git(remote, ['rev-parse', 'main'])).toBe(localCommit);
  });

  it('refuses clean content unless HEAD is the exact commit for this workflow and article', async () => {
    const { repository } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'unchanged.md'), '# Unchanged\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    git(repository, ['add', 'content/articles/unchanged.md', 'content/articles/translation.md']);
    git(repository, ['commit', '-m', 'Unrelated content commit']);
    const publisher = new GitSitePublisher(
      { getWorkspaceRoot: () => repository },
      new NodeGitCommandRunner(),
    );

    await expect(publisher.publish(request(repository, 'content/articles/unchanged.md'), signal))
      .rejects.toThrow('no changes to publish');
  });

  it.each([
    '../outside.md',
    'content/articles/../../outside.md',
    '/content/articles/post.md',
    'C:\\content\\articles\\post.md',
  ])('rejects absolute and traversal contentId %s before invoking Git', async (contentId) => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-path-'));
    const runner = { run: vi.fn<GitCommandRunner['run']>() };
    const publisher = new GitSitePublisher({ getWorkspaceRoot: () => repository }, runner);

    await expect(publisher.publish(request(repository, contentId), signal)).rejects.toThrow(/relative|traversal/u);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects an article outside target.contentDirectory', async () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-boundary-'));
    fs.mkdirSync(path.join(repository, 'content', 'articles'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'outside.md'), '# Outside\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    const publisher = new GitSitePublisher(
      { getWorkspaceRoot: () => repository },
      { run: vi.fn<GitCommandRunner['run']>() },
    );

    await expect(publisher.publish(request(repository, 'outside.md'), signal)).rejects.toThrow('target.contentDirectory');
  });

  it('rejects a symlink that escapes the content and workspace roots', async () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-symlink-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-outside-'));
    fs.mkdirSync(path.join(repository, 'content', 'articles'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'escape.md'), '# Escape\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    fs.symlinkSync(outside, path.join(repository, 'content', 'articles', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir');
    const publisher = new GitSitePublisher(
      { getWorkspaceRoot: () => repository },
      { run: vi.fn<GitCommandRunner['run']>() },
    );

    await expect(publisher.publish(request(repository, 'content/articles/linked/escape.md'), signal))
      .rejects.toThrow(/symlink escapes/u);
  });

  it('rejects post-approval hash changes before invoking Git', async () => {
    const { repository } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'post.md'), '# Approved\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    const approvedRequest = request(repository, 'content/articles/post.md');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'post.md'), '# Changed later\n');
    const runner = { run: vi.fn<GitCommandRunner['run']>() };
    const publisher = new GitSitePublisher({ getWorkspaceRoot: () => repository }, runner);

    await expect(publisher.publish(approvedRequest, signal)).rejects.toThrow('changed after approval');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('requires the exact publish branch before any Git mutation', async () => {
    const { repository } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'post.md'), '# Post\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    git(repository, ['switch', '-c', 'draft']);
    const calls: string[][] = [];
    const delegate = new NodeGitCommandRunner();
    const runner: GitCommandRunner = {
      async run(cwd, args, abortSignal) {
        calls.push([...args]);
        return delegate.run(cwd, args, abortSignal);
      },
    };
    const publisher = new GitSitePublisher({ getWorkspaceRoot: () => repository }, runner);

    await expect(publisher.publish(request(repository, 'content/articles/post.md'), signal))
      .rejects.toThrow('requires branch main');
    expect(calls.some(([command]) => ['add', 'commit', 'push'].includes(command ?? ''))).toBe(false);
  });

  it('rejects visual assets outside an approved asset directory', async () => {
    const { repository } = makeRepository();
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'post.md'), '# Post\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    fs.mkdirSync(path.join(repository, 'public', 'images'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'public', 'unapproved.png'), 'image');
    const publisher = new GitSitePublisher(
      { getWorkspaceRoot: () => repository },
      { run: vi.fn<GitCommandRunner['run']>() },
    );

    await expect(publisher.publish(request(repository, 'content/articles/post.md', 'site', [
      { path: 'content/articles/translation.md', role: 'translation' },
      { path: 'public/unapproved.png', role: 'visual-asset' },
    ]), signal)).rejects.toThrow('approved asset directory');
  });

  it('requires the configured workspace to be a Git repository', async () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-publisher-no-git-'));
    fs.mkdirSync(path.join(repository, 'content', 'articles'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'post.md'), '# Post\n');
    fs.writeFileSync(path.join(repository, 'content', 'articles', 'translation.md'), '# Translation\n');
    const publisher = new GitSitePublisher(
      { getWorkspaceRoot: () => repository },
      new NodeGitCommandRunner(),
    );

    await expect(publisher.publish(request(repository, 'content/articles/post.md'), signal)).rejects.toThrow();
  });
});

describe('ExactHttpPublicationVerifier', () => {
  it('verifies only a successful response at the exact HTTPS article URL', async () => {
    const client: PublicationHttpClient = {
      getExact: vi.fn().mockResolvedValue({ status: 200, url: 'https://example.com/articles/safe-post' }),
    };
    const verifier = new ExactHttpPublicationVerifier(client);

    await expect(verifier.verify('https://example.com/articles/safe-post', signal)).resolves.toEqual({
      publicationUrl: 'https://example.com/articles/safe-post',
      status: 200,
    });
    expect(client.getExact).toHaveBeenCalledWith('https://example.com/articles/safe-post', signal);
  });

  it.each(['http://example.com/articles/post', 'https://example.com/articles/post?preview=1'])
  ('rejects non-exact HTTPS URL %s', async (url) => {
    const client = { getExact: vi.fn<PublicationHttpClient['getExact']>() };
    const verifier = new ExactHttpPublicationVerifier(client);
    await expect(verifier.verify(url, signal)).rejects.toThrow(/exact HTTPS/u);
    expect(client.getExact).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 404, url: 'https://example.com/articles/post' }, /successful response/u],
    [{ status: 200, url: 'https://example.com/articles/other' }, /exactly match/u],
  ])('rejects unsuccessful or non-exact responses', async (response, expected) => {
    const verifier = new ExactHttpPublicationVerifier({ getExact: vi.fn().mockResolvedValue(response) });
    await expect(verifier.verify('https://example.com/articles/post', signal)).rejects.toThrow(expected);
  });
});

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  SitePublicationRequest,
  SitePublicationResult,
  SitePublisher,
} from '../../application/publication/publishers';
import type { PublicationSiteTarget } from '../../domain/publication/configuration';
import {
  createPublicationBundle,
  type PublicationArtifact,
  type PublicationBundle,
} from '../../domain/publication/workflow';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;
const IMMUTABLE_GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

function bundleFingerprint(bundle: PublicationBundle): string {
  const canonical = [
    bundle.contentId,
    bundle.primaryArticlePath,
    ...bundle.artifacts
      .map((artifact) => `${artifact.role}\0${artifact.path}\0${artifact.sha256}`)
      .sort(),
  ].join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function commitMessage(request: SitePublicationRequest, articlePath: string): string {
  return [
    `Publish ${articlePath}`,
    '',
    `Publication-Workflow: ${request.workflowId}`,
    `Publication-Bundle: ${bundleFingerprint(request.bundle)}`,
  ].join('\n');
}

function immutableReference(value: string): string {
  const reference = value.trim().toLowerCase();
  if (!IMMUTABLE_GIT_SHA.test(reference)) {
    throw new Error('Git did not return an immutable commit SHA');
  }
  return reference;
}

export interface PublicationWorkspaceRootResolver {
  getWorkspaceRoot(workspaceId: string): string | Promise<string>;
}

export interface GitCommandRunner {
  run(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string>;
}

export class NodeGitCommandRunner implements GitCommandRunner {
  async run(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string> {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      signal,
      windowsHide: true,
    });
    return stdout;
  }
}

export interface CandidatePublicationUrlResolver {
  resolve(target: PublicationSiteTarget, articlePathWithinContentDirectory: string): string;
}

export class PathBasedCandidatePublicationUrlResolver implements CandidatePublicationUrlResolver {
  resolve(target: PublicationSiteTarget, articlePathWithinContentDirectory: string): string {
    const sourceSegments = articlePathWithinContentDirectory.split('/');
    const filename = sourceSegments.pop();
    if (!filename) throw new Error('Article path must identify a file');

    const routeFilename = filename.replace(/\.(?:md|mdx|html?)$/iu, '');
    if (routeFilename !== 'index') sourceSegments.push(routeFilename);
    const route = sourceSegments.map((segment) => encodeURIComponent(segment)).join('/');
    const baseUrl = target.publicBaseUrl ?? `https://${target.displayDomain}`;
    const candidate = new URL(route, `${baseUrl.replace(/\/$/u, '')}/`);
    if (candidate.protocol !== 'https:') throw new Error('Candidate publication URL must use HTTPS');
    return candidate.toString();
  }
}

type ResolvedBundle = Readonly<{
  workspaceRoot: string;
  artifacts: readonly Readonly<{ artifact: PublicationArtifact; lexicalPath: string }>[];
  primaryPathWithinContentDirectory: string;
}>;

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelativeArtifactPath(artifactPath: string): string {
  if (!artifactPath || /[\u0000-\u001f\u007f]/u.test(artifactPath)) {
    throw new Error('Artifact path must be a non-empty relative path');
  }
  if (path.isAbsolute(artifactPath) || path.win32.isAbsolute(artifactPath)) {
    throw new Error('Artifact path must be a relative path');
  }
  const segments = artifactPath.split(/[\\/]+/u);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Artifact path must not contain traversal or empty path segments');
  }
  return segments.join(path.sep);
}

async function resolveApprovedBundle(
  rootResolver: PublicationWorkspaceRootResolver,
  request: SitePublicationRequest,
): Promise<ResolvedBundle> {
  const normalizedArtifactPaths = request.bundle.artifacts.map(({ path: artifactPath }) =>
    normalizeRelativeArtifactPath(artifactPath));
  const configuredRoot = await rootResolver.getWorkspaceRoot(request.target.workspaceId);
  const workspaceRoot = path.resolve(await fs.realpath(configuredRoot));
  const contentDirectoryPath = path.resolve(workspaceRoot, request.target.contentDirectory);
  if (!isWithin(workspaceRoot, contentDirectoryPath)) throw new Error('Content directory escapes the workspace');
  const realContentDirectory = path.resolve(await fs.realpath(contentDirectoryPath));
  if (!isWithin(workspaceRoot, realContentDirectory)) {
    throw new Error('Content directory symlink escapes the configured workspace');
  }
  const assetDirectoryPaths = await Promise.all((request.target.approvedAssetDirectories ?? []).map(
    async (directory) => {
      const lexicalDirectory = path.resolve(workspaceRoot, directory);
      if (!isWithin(workspaceRoot, lexicalDirectory)) throw new Error('Approved asset directory escapes the workspace');
      const realDirectory = path.resolve(await fs.realpath(lexicalDirectory));
      if (!isWithin(workspaceRoot, realDirectory)) {
        throw new Error('Approved asset directory symlink escapes the configured workspace');
      }
      return { lexicalDirectory, realDirectory };
    },
  ));

  const artifacts = await Promise.all(request.bundle.artifacts.map(async (artifact, index) => {
    const lexicalPath = path.resolve(workspaceRoot, normalizedArtifactPaths[index]);
    if (!isWithin(workspaceRoot, lexicalPath)) throw new Error(`Artifact path escapes the workspace: ${artifact.path}`);
    const realArtifactPath = path.resolve(await fs.realpath(lexicalPath));
    if (!isWithin(workspaceRoot, realArtifactPath)) {
      throw new Error(`Artifact symlink escapes the configured workspace: ${artifact.path}`);
    }
    if (!(await fs.stat(realArtifactPath)).isFile()) {
      throw new Error(`Artifact must identify a file: ${artifact.path}`);
    }
    if (artifact.role === 'primary-article' || artifact.role === 'translation') {
      if (!isWithin(contentDirectoryPath, lexicalPath) || !isWithin(realContentDirectory, realArtifactPath)) {
        throw new Error(`${artifact.role} must be inside target.contentDirectory`);
      }
    } else if (!assetDirectoryPaths.some(({ lexicalDirectory, realDirectory }) =>
      isWithin(lexicalDirectory, lexicalPath) && isWithin(realDirectory, realArtifactPath))) {
      throw new Error(`${artifact.role} must be inside an approved asset directory`);
    }
    const actualHash = createHash('sha256').update(await fs.readFile(realArtifactPath)).digest('hex');
    if (actualHash !== artifact.sha256) {
      throw new Error(`Artifact SHA-256 changed after approval: ${artifact.path}`);
    }
    return Object.freeze({ artifact, lexicalPath });
  }));
  const primary = artifacts.find(({ artifact }) => artifact.role === 'primary-article');
  if (!primary) throw new Error('Approved bundle has no primary article');
  if (primary.artifact.path !== request.bundle.primaryArticlePath) {
    throw new Error('Approved primary article path does not match the bundle');
  }

  return {
    workspaceRoot,
    artifacts: Object.freeze(artifacts),
    primaryPathWithinContentDirectory: path.relative(contentDirectoryPath, primary.lexicalPath)
      .split(path.sep).join('/'),
  };
}

export class GitSitePublisher implements SitePublisher {
  constructor(
    private readonly workspaceRoots: PublicationWorkspaceRootResolver,
    private readonly git: GitCommandRunner = new NodeGitCommandRunner(),
    private readonly urlResolver: CandidatePublicationUrlResolver = new PathBasedCandidatePublicationUrlResolver(),
  ) {}

  async publish(request: SitePublicationRequest, signal: AbortSignal): Promise<SitePublicationResult> {
    signal.throwIfAborted();
    const approvedBundle = createPublicationBundle(request.bundle);
    if (request.contentId !== approvedBundle.contentId) {
      throw new Error('Publication request contentId does not match the approved bundle');
    }
    const approvedRequest = Object.freeze({ ...request, bundle: approvedBundle });
    const bundle = await resolveApprovedBundle(this.workspaceRoots, approvedRequest);
    const repositoryOutput = await this.git.run(bundle.workspaceRoot, ['rev-parse', '--show-toplevel'], signal);
    const repositoryRoot = path.resolve(await fs.realpath(repositoryOutput.trim()));
    if (!bundle.artifacts.every(({ lexicalPath }) => isWithin(repositoryRoot, lexicalPath))) {
      throw new Error('Approved bundle is not inside the resolved Git repository');
    }

    const currentBranch = (await this.git.run(
      repositoryRoot,
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      signal,
    )).trim();
    if (currentBranch !== approvedRequest.target.publishBranch) {
      throw new Error(`Publication requires branch ${approvedRequest.target.publishBranch}; current branch is ${currentBranch || 'detached'}`);
    }

    const repositoryRelativePaths = bundle.artifacts.map(({ lexicalPath }) =>
      path.relative(repositoryRoot, lexicalPath).split(path.sep).join('/'));
    const status = await this.git.run(
      repositoryRoot,
      ['status', '--porcelain=v1', '--untracked-files=all', '--', ...repositoryRelativePaths],
      signal,
    );
    const publicationUrl = this.urlResolver.resolve(
      approvedRequest.target,
      bundle.primaryPathWithinContentDirectory,
    );
    const expectedCommitMessage = commitMessage(approvedRequest, bundle.primaryPathWithinContentDirectory);

    if (!status.trim()) {
      const actualCommitMessage = (
        await this.git.run(repositoryRoot, ['log', '-1', '--format=%B'], signal)
      ).trimEnd();
      const committedPaths = (
        await this.git.run(
          repositoryRoot,
          ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD'],
          signal,
        )
      ).split(/\r?\n/u).filter(Boolean);
      if (
        actualCommitMessage !== expectedCommitMessage
        || committedPaths.length !== repositoryRelativePaths.length
        || committedPaths.sort().some((committedPath, index) =>
          committedPath !== [...repositoryRelativePaths].sort()[index])
      ) {
        throw new Error('Approved bundle has no changes to publish');
      }

      const publisherReference = immutableReference(
        await this.git.run(repositoryRoot, ['rev-parse', 'HEAD'], signal),
      );
      await this.git.run(
        repositoryRoot,
        ['push', 'origin', `HEAD:refs/heads/${approvedRequest.target.publishBranch}`],
        signal,
      );
      return Object.freeze({ publicationUrl, publisherReference });
    }

    await this.git.run(repositoryRoot, ['add', '--', ...repositoryRelativePaths], signal);
    await this.git.run(
      repositoryRoot,
      ['commit', '--only', '-m', expectedCommitMessage, '--', ...repositoryRelativePaths],
      signal,
    );
    const publisherReference = immutableReference(
      await this.git.run(repositoryRoot, ['rev-parse', 'HEAD'], signal),
    );
    await this.git.run(
      repositoryRoot,
      ['push', 'origin', `HEAD:refs/heads/${approvedRequest.target.publishBranch}`],
      signal,
    );

    // This URL is only a deterministic candidate. Live verification is deliberately separate.
    return Object.freeze({ publicationUrl, publisherReference });
  }
}

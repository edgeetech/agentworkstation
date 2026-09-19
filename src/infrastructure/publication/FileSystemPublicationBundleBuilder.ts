import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createPublicationBundle,
  type PublicationArtifact,
  type PublicationArtifactRole,
  type PublicationBundle,
} from '../../domain/publication/workflow';
import type { PublicationSiteTarget } from '../../domain/publication/configuration';
import type { PublicationWorkspaceRootResolver } from './GitSitePublisher';

export type PublicationBundlePaths = Readonly<{
  contentId: string;
  primaryArticlePath: string;
  translationPaths: readonly string[];
  visualAssetPaths?: readonly string[];
  otherAssetPaths?: readonly string[];
}>;

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizeRelativePath(value: string): string {
  const normalized = value.trim();
  if (!normalized || path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error('Publication artifact paths must be non-empty relative paths');
  }
  const segments = normalized.split(/[\\/]+/u);
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Publication artifact paths must not contain traversal or empty segments');
  }
  return segments.join('/');
}

export class FileSystemPublicationBundleBuilder {
  constructor(private readonly workspaceRoots: PublicationWorkspaceRootResolver) {}

  async build(target: PublicationSiteTarget, input: PublicationBundlePaths): Promise<PublicationBundle> {
    const artifact = (artifactPath: string, role: PublicationArtifactRole) => ({ path: artifactPath, role });
    const candidates: Array<{ path: string; role: PublicationArtifactRole }> = [
      artifact(input.primaryArticlePath, 'primary-article'),
      ...input.translationPaths.map((artifactPath) => artifact(artifactPath, 'translation')),
      ...(input.visualAssetPaths ?? []).map((artifactPath) => artifact(artifactPath, 'visual-asset')),
      ...(input.otherAssetPaths ?? []).map((artifactPath) => artifact(artifactPath, 'other-asset')),
    ].map((artifact): { path: string; role: PublicationArtifactRole } => ({
      path: normalizeRelativePath(artifact.path),
      role: artifact.role,
    }));

    const workspaceRoot = path.resolve(await fs.realpath(await this.workspaceRoots.getWorkspaceRoot(target.workspaceId)));
    const contentRoot = await this.resolveDirectory(workspaceRoot, target.contentDirectory, 'Article folder');
    const assetRoots = await Promise.all((target.approvedAssetDirectories ?? []).map((directory) =>
      this.resolveDirectory(workspaceRoot, directory, 'Approved asset folder')));

    const artifacts: PublicationArtifact[] = [];
    for (const candidate of candidates) {
      const lexicalPath = path.resolve(workspaceRoot, candidate.path);
      if (!isWithin(workspaceRoot, lexicalPath)) throw new Error(`Artifact escapes the workspace: ${candidate.path}`);
      const realPath = path.resolve(await fs.realpath(lexicalPath));
      if (!isWithin(workspaceRoot, realPath) || !(await fs.stat(realPath)).isFile()) {
        throw new Error(`Artifact must be a workspace file: ${candidate.path}`);
      }
      if (candidate.role === 'primary-article' || candidate.role === 'translation') {
        if (!isWithin(contentRoot.lexical, lexicalPath) || !isWithin(contentRoot.real, realPath)) {
          throw new Error(`${candidate.role} must be inside the configured article folder`);
        }
      } else if (!assetRoots.some((root) => isWithin(root.lexical, lexicalPath) && isWithin(root.real, realPath))) {
        throw new Error(`${candidate.role} must be inside an approved asset folder`);
      }
      artifacts.push(Object.freeze({
        path: candidate.path,
        role: candidate.role,
        sha256: createHash('sha256').update(await fs.readFile(realPath)).digest('hex'),
      }));
    }

    return createPublicationBundle({
      contentId: input.contentId,
      primaryArticlePath: normalizeRelativePath(input.primaryArticlePath),
      artifacts,
    });
  }

  private async resolveDirectory(
    workspaceRoot: string,
    relativeDirectory: string,
    label: string,
  ): Promise<{ lexical: string; real: string }> {
    const lexical = path.resolve(workspaceRoot, normalizeRelativePath(relativeDirectory));
    if (!isWithin(workspaceRoot, lexical)) throw new Error(`${label} escapes the workspace`);
    const real = path.resolve(await fs.realpath(lexical));
    if (!isWithin(workspaceRoot, real) || !(await fs.stat(real)).isDirectory()) {
      throw new Error(`${label} must be a workspace directory`);
    }
    return { lexical, real };
  }
}

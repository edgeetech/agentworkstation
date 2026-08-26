import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceGateway } from '@application/ports';

const denied = ['.env', '.env.', '.pem', '.key', 'id_rsa', 'id_ed25519', 'credentials.', 'secrets.'];

function isSensitiveName(name: string): boolean {
  const normalized = name.toLowerCase();
  return denied.some((part) => normalized.includes(part));
}

function isSensitiveRelativePath(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some(isSensitiveName);
}

export class DefaultWorkspaceGateway implements WorkspaceGateway {
  constructor(private readonly roots: Record<string, string>) {}

  getWorkspaceRoot(workspaceId: string): string {
    const root = this.roots[workspaceId];
    if (!root) throw new Error(`Unknown workspace: ${workspaceId}`);
    return root;
  }

  async listDirectory(workspaceId: string, relativePath: string): Promise<string[]> {
    const resolved = await this.resolve(workspaceId, relativePath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries
      .map((entry) => entry.name)
      .filter((name) => !isSensitiveName(name));
  }

  async readFile(workspaceId: string, relativePath: string): Promise<{ content: string; source: string }> {
    const resolved = await this.resolve(workspaceId, relativePath);
    const stat = await fs.stat(resolved);
    if (stat.size > 1024 * 1024) throw new Error('File too large');
    const content = await fs.readFile(resolved, 'utf8');
    return { content, source: `file:${relativePath}` };
  }

  async readFileIfExists(workspaceId: string, relativePath: string): Promise<{ content: string; source: string } | null> {
    const resolved = await this.resolve(workspaceId, relativePath);
    try {
      const stat = await fs.stat(resolved);
      if (stat.size > 1024 * 1024) throw new Error('File too large');
      const content = await fs.readFile(resolved, 'utf8');
      return { content, source: `file:${relativePath}` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeFileAtomic(workspaceId: string, relativePath: string, content: string): Promise<void> {
    const resolved = await this.resolve(workspaceId, relativePath, { allowMissingLeaf: true });
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const tempPath = `${resolved}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, resolved);
  }

  private async resolve(
    workspaceId: string,
    relativePath: string,
    options: { allowMissingLeaf?: boolean } = {},
  ): Promise<string> {
    const segments = relativePath.split(/[\\/]+/);
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || segments.includes('..')) {
      throw new Error('Invalid path');
    }
    const root = path.resolve(await fs.realpath(this.getWorkspaceRoot(workspaceId)));
    const candidate = path.join(root, relativePath);
    const realTarget = options.allowMissingLeaf
      ? path.resolve(await fs.realpath(path.dirname(candidate)), path.basename(candidate))
      : await fs.realpath(candidate);
    const target = path.resolve(realTarget);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes workspace');
    if (isSensitiveRelativePath(relativePath)) throw new Error('Sensitive file denied');
    return target;
  }
}

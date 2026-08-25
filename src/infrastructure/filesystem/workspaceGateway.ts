import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceGateway } from '@application/ports';

const denied = ['.env', '.env.', '.pem', '.key', 'id_rsa', 'id_ed25519', 'credentials.', 'secrets.'];

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
    return entries.map((entry) => entry.name);
  }

  async readFile(workspaceId: string, relativePath: string): Promise<{ content: string; source: string }> {
    const resolved = await this.resolve(workspaceId, relativePath);
    const stat = await fs.stat(resolved);
    if (stat.size > 1024 * 1024) throw new Error('File too large');
    const content = await fs.readFile(resolved, 'utf8');
    return { content, source: `file:${relativePath}` };
  }

  private async resolve(workspaceId: string, relativePath: string): Promise<string> {
    if (path.isAbsolute(relativePath) || relativePath.includes('..')) throw new Error('Invalid path');
    const root = path.resolve(await fs.realpath(this.getWorkspaceRoot(workspaceId)));
    const target = path.resolve(await fs.realpath(path.join(root, relativePath)));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Path escapes workspace');
    if (denied.some((part) => path.basename(target).includes(part) || target.includes(part))) throw new Error('Sensitive file denied');
    return target;
  }
}

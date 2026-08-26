import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalService } from '../../src/application/approvals';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';

describe('safe editing acceptance demo', () => {
  it('applies the selected GitHub README recommendation through pending approval and atomic execution', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-safe-edit-'));
    fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Agent Workstation\n\nOld summary.\n');
    const gateway = new DefaultWorkspaceGateway({ profile: workspaceRoot });
    const persistence = new SqlitePersistence(path.join(os.tmpdir(), `aw-safe-${Date.now()}.db`));
    const approvals = new ApprovalService(persistence, gateway);

    const pending = await approvals.proposeWrite({
      workspaceId: 'profile',
      targetPath: 'README.md',
      proposedContent: '# Agent Workstation\n\nUpdated summary from Career Agent recommendation.\n',
      sessionId: 'safe-edit-demo',
    });

    expect(pending.status).toBe('PROPOSED');
    expect(pending.diff).toContain('README.md');

    const executed = await approvals.approveAndExecute(pending.id, 'profile');
    expect(executed.status).toBe('EXECUTED');
    expect(fs.readFileSync(path.join(workspaceRoot, 'README.md'), 'utf8'))
      .toContain('Updated summary from Career Agent recommendation.');
  });
});

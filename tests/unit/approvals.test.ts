import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalService } from '../../src/application/approvals';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';
import { SqlitePersistence } from '../../src/infrastructure/persistence/sqlite';
import { createFilesystemProposeWriteTool } from '../../src/infrastructure/filesystem/filesystemTools';

function makeDb(): SqlitePersistence {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-approval-db-')), 'app.db');
  return new SqlitePersistence(file);
}

describe('approval service', () => {
  it('creates pending actions with a deterministic diff and executes approved writes atomically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-approval-ws-'));
    fs.writeFileSync(path.join(root, 'README.md'), 'old text\n');
    const gateway = new DefaultWorkspaceGateway({ project: root });
    const persistence = makeDb();
    const approvals = new ApprovalService(persistence, gateway);

    const action = await approvals.proposeWrite({
      workspaceId: 'project',
      targetPath: 'README.md',
      proposedContent: 'new text\n',
      sessionId: 'session-1',
    });

    expect(action.status).toBe('PROPOSED');
    expect(action.diff).toContain('--- a/README.md');
    expect(action.diff).toContain('+new text');

    const executed = await approvals.approveAndExecute(action.id, 'project');
    expect(executed.status).toBe('EXECUTED');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('new text\n');
  });

  it('rejects stale approvals when target file changed after proposal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-approval-stale-'));
    fs.writeFileSync(path.join(root, 'README.md'), 'version A\n');
    const gateway = new DefaultWorkspaceGateway({ project: root });
    const persistence = makeDb();
    const approvals = new ApprovalService(persistence, gateway);

    const action = await approvals.proposeWrite({
      workspaceId: 'project',
      targetPath: 'README.md',
      proposedContent: 'version B\n',
      sessionId: 'session-2',
    });

    fs.writeFileSync(path.join(root, 'README.md'), 'version C\n');
    await expect(approvals.approveAndExecute(action.id, 'project')).rejects.toThrow('stale');

    const stale = await persistence.getPendingAction(action.id);
    expect(stale?.status).toBe('STALE');
  });

  it('creates pending actions through filesystem.proposeWrite without writing files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-approval-tool-'));
    fs.writeFileSync(path.join(root, 'README.md'), 'initial\n');
    const gateway = new DefaultWorkspaceGateway({ project: root });
    const persistence = makeDb();
    const approvals = new ApprovalService(persistence, gateway);
    const proposeTool = createFilesystemProposeWriteTool(approvals, 'session-tool');

    const result = await proposeTool.execute(
      { workspaceId: 'project', targetPath: 'README.md', proposedContent: 'proposed\n' },
      { workspaceId: 'project', signal: new AbortController().signal, workspaceGateway: gateway },
    );

    const output = result.output as { actionId: string; status: string; diff: string };
    expect(output.status).toBe('PROPOSED');
    expect(output.actionId).toBeTruthy();
    expect(output.diff).toContain('+++ b/README.md');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('initial\n');
  });
});

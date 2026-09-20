import { describe, expect, it } from 'vitest';
import { tallyProposals, type PendingAction } from '../../src/domain/actions';

function makeAction(status: PendingAction['status'], id: string): PendingAction {
  return {
    id,
    sessionId: 'session-1',
    createdAt: new Date().toISOString(),
    status,
    workspaceId: 'project',
    expectedOriginalHash: 'sha256:0',
    proposedContentHash: 'sha256:1',
    targetPath: 'README.md',
    proposedContent: 'content',
    diff: 'diff',
  };
}

describe('tallyProposals', () => {
  it('counts EXECUTED as approved and caps the window at the given limit', () => {
    const actions = [
      makeAction('EXECUTED', '1'),
      makeAction('APPROVED', '2'),
      makeAction('REJECTED', '3'),
      makeAction('REJECTED', '4'),
      makeAction('PROPOSED', '5'),
    ];

    expect(tallyProposals(actions, 4)).toEqual({ limit: 4, total: 4, approved: 2, rejected: 2 });
  });

  it('excludes PROPOSED and STALE actions from the approved/rejected counts', () => {
    const actions = [makeAction('PROPOSED', '1'), makeAction('STALE', '2')];
    expect(tallyProposals(actions, 10)).toEqual({ limit: 10, total: 2, approved: 0, rejected: 0 });
  });

  it('defaults to a window of 10', () => {
    const actions = Array.from({ length: 15 }, (_, index) => makeAction('APPROVED', String(index)));
    expect(tallyProposals(actions)).toEqual({ limit: 10, total: 10, approved: 10, rejected: 0 });
  });

  it('returns zeros for an empty history', () => {
    expect(tallyProposals([])).toEqual({ limit: 10, total: 0, approved: 0, rejected: 0 });
  });
});

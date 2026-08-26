import { describe, expect, it } from 'vitest';
import { buildDeterministicCareerAuditScenario } from '../../src/application/careerAuditScenario';

describe('career audit scenario', () => {
  it('returns a deterministic audit summary with source references for the UI and evaluation harness', () => {
    const scenario = buildDeterministicCareerAuditScenario();

    expect(scenario.title).toContain('Career Audit');
    expect(scenario.result.workspaceIds).toEqual(['profile', 'project']);
    expect(scenario.result.sourceReferences).toContainEqual({
      type: 'git_commit',
      workspaceId: 'project',
      commitSha: '7f3a4c9',
      label: 'project:7f3a4c9',
    });
    expect(scenario.result.content).toContain('Missing From Profile');
    expect(scenario.result.contextUsage.totalContentBytes).toBeGreaterThan(0);
  });
});

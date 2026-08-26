import type { SourceReference } from '@domain/intelligence';
import type { CareerAuditResult } from './careerAudit';

export type CareerAuditScenario = {
  title: string;
  summary: string;
  result: CareerAuditResult;
};

export function buildDeterministicCareerAuditScenario(): CareerAuditScenario {
  const sourceReferences: SourceReference[] = [
    { type: 'memory', relativePath: 'memory/profile.md', label: 'memory/profile.md' },
    { type: 'git_commit', workspaceId: 'project', commitSha: '7f3a4c9', label: 'project:7f3a4c9' },
    { type: 'git_commit', workspaceId: 'profile', commitSha: '9b0f12d', label: 'profile:9b0f12d' },
  ];

  const result: CareerAuditResult = {
    content: [
      '## New Evidence',
      '',
      '- Recent project work demonstrates ownership of the local-first workflow and provenance-aware tool loop.',
      '- Profile memory still describes the older platform-only positioning.',
      '',
      '## Missing From Profile',
      '',
      '- Evidence-backed local agent workflow experience',
      '- Multi-workspace repository auditing and evidence synthesis',
      '',
      '## Recommended Changes',
      '',
      '- Add a short section on local-first career agent tooling and evidence-oriented workflow design.',
      '- Call out repository audit and Git provenance work as a professional capability.',
      '',
      '## Evidence',
      '',
      '- memory/profile.md',
      '- project:7f3a4c9',
      '- profile:9b0f12d',
    ].join('\n'),
    sourceReferences,
    workspaceIds: ['profile', 'project'],
    contextUsage: {
      instructionsBytes: 1280,
      memoryBytes: 960,
      conversationBytes: 720,
      toolResultBytes: 1120,
      totalContentBytes: 4080,
    },
    truncatedContext: [],
  };

  return {
    title: 'Career Audit — local-first evidence workflow',
    summary: 'Comparison between recent project activity and the current profile reveals missed evidence around local-first agent infrastructure and audit tooling.',
    result,
  };
}

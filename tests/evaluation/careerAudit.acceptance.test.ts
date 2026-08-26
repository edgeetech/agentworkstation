import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CareerAgentLoader } from '../../src/application/agents/CareerAgentLoader';
import { FileSystemAgentDefinitionSource } from '../../src/infrastructure/agents/FileSystemAgentDefinitionSource';
import { ContextBuilder } from '../../src/application/context';
import { CareerAuditService } from '../../src/application/careerAudit';
import { AgentRuntime } from '../../src/application/intelligence';
import { ToolExecutor, ToolRegistry, PolicyGate } from '../../src/application/tools';
import type { IntelligencePort, ModelRequest } from '../../src/domain/intelligence';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';
import { gitLogTool, gitStatusTool } from '../../src/infrastructure/git/gitTools';

function createGitRepo(prefix: string, files: Array<{ name: string; content: string }>, message: string): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  for (const file of files) {
    fs.writeFileSync(path.join(repo, file.name), file.content);
  }
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', message], { cwd: repo });
  return repo;
}

describe('career audit acceptance demo', () => {
  it('compares recent project activity with profile context and returns evidence-backed gaps', async () => {
    const profileRepo = createGitRepo(
      'aw-profile-',
      [{ name: 'README.md', content: '# Profile\n\nLegacy summary only.' }],
      'docs: profile baseline',
    );
    const projectRepo = createGitRepo(
      'aw-project-',
      [{ name: 'CHANGELOG.md', content: '# Changelog\n\n- Added local-first multi-workspace audit flow.' }],
      'feat: add multi-workspace career audit workflow',
    );

    const agentDir = path.resolve('src/agents/career');
    const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(agentDir));
    const agent = loader.load();

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(gitStatusTool);
    toolRegistry.register(gitLogTool);
    const toolExecutor = new ToolExecutor(toolRegistry);
    const policyGate = new PolicyGate();
    const workspaceGateway = new DefaultWorkspaceGateway({
      profile: profileRepo,
      project: projectRepo,
    });

    const modelRequests: ModelRequest[] = [];
    const intelligence: IntelligencePort = {
      async execute(request) {
        modelRequests.push(request);
        if (modelRequests.length === 1) {
          return {
            type: 'tool_call',
            call: { id: 'call-status-profile', toolName: 'git.status', input: { workspaceId: 'profile' } },
          };
        }
        if (modelRequests.length === 2) {
          return {
            type: 'tool_call',
            call: { id: 'call-log-project', toolName: 'git.log', input: { workspaceId: 'project', limit: 5 } },
          };
        }
        return {
          type: 'text',
          content: [
            '## New Evidence',
            '- Project repository has a recent commit introducing a local-first multi-workspace audit flow.',
            '',
            '## Missing From Profile',
            '- Profile does not mention multi-workspace audit implementation and provenance tracking.',
            '',
            '## Possibly Outdated',
            '- Profile summary still reflects the pre-audit capability baseline.',
            '',
            '## Inconsistencies',
            '- Claimed scope in profile is narrower than recent project delivery.',
            '',
            '## Recommended Changes',
            '- Add a concise achievement covering local-first multi-workspace career auditing.',
            '',
            '## Evidence',
            '- profile workspace git.status',
            '- project workspace git.log',
          ].join('\n'),
        };
      },
    };

    const runtime = new AgentRuntime(
      intelligence,
      {
        execute: (toolName, input, context) =>
          toolExecutor.execute(toolName, input, { ...context, workspaceGateway }),
        getMetadata: (toolName) => toolExecutor.getMetadata(toolName),
      },
      policyGate,
      {
        maxSteps: 6,
        maxToolCalls: 6,
        maxToolResultBytes: 64 * 1024,
        modelTimeoutMs: 10000,
        toolTimeoutMs: 10000,
      },
    );

    const registry = {
      saveWorkspace: async () => undefined,
      getWorkspace: async (id: string) =>
        [{ id: 'profile', rootPath: profileRepo }, { id: 'project', rootPath: projectRepo }]
          .find((workspace) => workspace.id === id) ?? null,
      listWorkspaces: async () => [
        { id: 'profile', rootPath: profileRepo },
        { id: 'project', rootPath: projectRepo },
      ],
      selectWorkspace: async () => undefined,
      getSelectedWorkspace: async () => ({ id: 'project', rootPath: projectRepo }),
    };

    const audit = new CareerAuditService(
      registry,
      runtime,
      new ContextBuilder(),
      {
        maxInstructionsBytes: 8 * 1024,
        maxMemoryBytes: 4 * 1024,
        maxConversationBytes: 4 * 1024,
        maxToolResultBytes: 8 * 1024,
        maxTotalContentBytes: 24 * 1024,
      },
    );

    const result = await audit.run(
      {
        agent,
        userMessage: 'Compare my recent project activity with my current professional profile and identify important gaps.',
        modelId: 'mock-local',
        tools: toolRegistry.getModelTools(),
      },
      new AbortController().signal,
    );

    expect(result.workspaceIds).toEqual(['profile', 'project']);
    expect(result.content).toContain('## Missing From Profile');
    expect(result.content).toContain('## Evidence');
    expect(result.sourceReferences).toContainEqual({
      type: 'memory',
      relativePath: 'memory/profile.md',
      label: 'memory/profile.md',
    });
    expect(result.sourceReferences).toContainEqual({
      type: 'git_status',
      workspaceId: 'profile',
      label: 'git.status',
    });
    expect(result.sourceReferences).toContainEqual({
      type: 'git_commit',
      workspaceId: 'project',
      label: 'git.log(limit=5)',
    });
  });
});

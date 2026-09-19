import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { CareerAgentLoader } from '../../src/application/agents/CareerAgentLoader';
import { FileSystemAgentDefinitionSource } from '../../src/infrastructure/agents/FileSystemAgentDefinitionSource';
import { ToolRegistry, ToolExecutor, PolicyGate } from '../../src/application/tools';
import { AgentRuntime } from '../../src/application/intelligence';
import { buildWorkspaceAccessInstructions } from '../../src/application/workspaces';
import type { IntelligencePort, ModelRequest } from '../../src/domain/intelligence';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';
import { gitLogTool } from '../../src/infrastructure/git/gitTools';

describe('Career Agent loader integration', () => {
  it('loads agent definition from declarative files', () => {
    const agentDir = path.resolve('src/agents/career');
    const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(agentDir));
    const agent = loader.load();

    expect(agent.id).toBe('career');
    expect(agent.name).toBe('Career');
    expect(agent.toolPolicies['web.read']).toBe('allow');
    expect(agent.toolPolicies['git.log']).toBe('allow');
    expect(agent.toolPolicies['filesystem.read']).toBe('allow');
    expect(agent.toolPolicies['filesystem.proposeWrite']).toBe('require_approval');
    expect(agent.quickActions).toContainEqual(expect.objectContaining({
      id: 'audit-profile',
      workflow: 'career-audit',
    }));
    expect(agent.systemPrompt).toContain('Evidence-first');
    expect(agent.systemPrompt).not.toContain('## Career memory');
    expect(agent.workflows.some((file) => file.relativePath === 'workflows/project-evidence.md')).toBe(true);
    expect(agent.memory.some((file) => file.relativePath === 'memory/projects.md')).toBe(true);
    expect(agent.memoryContext.content).toContain('### memory/projects.md');
    expect(agent.memoryContext.sourceReferences).toContainEqual({
      type: 'memory',
      relativePath: 'memory/projects.md',
      label: 'memory/projects.md',
    });
  });

  it('runs repository evidence workflow through application layers without bypassing them', async () => {
    // Set up a real git repo fixture
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agent-test-'));
    execFileSync('git', ['init'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test project');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'feat: initial project setup'], { cwd: repo });

    // Set up application layers
    const agentDir = path.resolve('src/agents/career');
    const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(agentDir));
    const agent = loader.load();

    const gateway = new DefaultWorkspaceGateway({ 'test-repo': repo });
    const registry = new ToolRegistry();
    registry.register(gitLogTool);

    const executor = new ToolExecutor(registry);
    const gate = new PolicyGate();

    const modelRequests: ModelRequest[] = [];
    const intelligence: IntelligencePort = {
      async execute(request) {
        modelRequests.push(request);
        if (modelRequests.length === 1) {
          return {
            type: 'tool_call',
            call: { id: 'call-git-log', toolName: 'git.log', input: { workspaceId: 'test-repo', limit: 5 } },
          };
        }
        return { type: 'text', content: 'Recent work: initial project setup commit found in repository.' };
      },
    };

    const runtime = new AgentRuntime(
      intelligence,
      {
        execute: (toolName, input, context) => executor.execute(toolName, input, { ...context, workspaceGateway: gateway }),
        getMetadata: (toolName) => executor.getMetadata(toolName),
      },
      gate,
      { maxSteps: 5, maxToolCalls: 5, maxToolResultBytes: 64 * 1024, modelTimeoutMs: 10000, toolTimeoutMs: 10000 },
    );

    const result = await runtime.run(
      {
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: 'What did I work on recently in this repository?' },
        ],
        tools: registry.getModelTools(),
      },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'test-repo' },
      new AbortController().signal,
    );

    expect(result).toContain('Recent work');
    expect(modelRequests).toHaveLength(2);
    const toolMessage = modelRequests[1].messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('initial project setup');
    expect(toolMessage?.content).toContain('[source: git_commit:git.log(limit=5)]');
    expect(modelRequests[1].tools?.[0].inputSchema).toMatchObject({
      required: ['workspaceId'],
    });
  });

  it('maps a named registered root to a non-selected workspace tool call', async () => {
    const projectRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-path-mapping-'));
    execFileSync('git', ['init'], { cwd: projectRepo });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: projectRepo });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: projectRepo });
    fs.writeFileSync(path.join(projectRepo, 'README.md'), '# Mapped project');
    execFileSync('git', ['add', '.'], { cwd: projectRepo });
    execFileSync('git', ['commit', '-m', 'feat: mapped workspace evidence'], { cwd: projectRepo });

    const registrations = [
      { id: 'profile', rootPath: path.dirname(projectRepo), kind: 'profile' as const },
      { id: 'project', rootPath: projectRepo, kind: 'project' as const },
    ];
    const requestLog: ModelRequest[] = [];
    const intelligence: IntelligencePort = {
      async execute(request) {
        requestLog.push(request);
        if (requestLog.length === 1) {
          expect(request.messages[0]?.content).toContain(`"id":"project","rootPath":${JSON.stringify(projectRepo)}`);
          expect(request.messages.at(-1)?.content).toContain(projectRepo);
          return {
            type: 'tool_call',
            call: { id: 'call-mapped-log', toolName: 'git.log', input: { workspaceId: 'project', limit: 1 } },
          };
        }
        return { type: 'text', content: 'Mapped project evidence inspected.' };
      },
    };
    const gateway = new DefaultWorkspaceGateway(Object.fromEntries(
      registrations.map((workspace) => [workspace.id, workspace.rootPath]),
    ));
    const registry = new ToolRegistry();
    registry.register(gitLogTool);
    const executor = new ToolExecutor(registry);
    const runtime = new AgentRuntime(
      intelligence,
      {
        execute: (toolName, input, context) => executor.execute(toolName, input, { ...context, workspaceGateway: gateway }),
        getMetadata: (toolName) => executor.getMetadata(toolName),
      },
      new PolicyGate(),
      { maxSteps: 3, maxToolCalls: 2, maxToolResultBytes: 64 * 1024, modelTimeoutMs: 10_000, toolTimeoutMs: 10_000 },
    );

    const result = await runtime.run({
      messages: [
        { role: 'system', content: buildWorkspaceAccessInstructions(registrations, 'profile') },
        { role: 'user', content: `Inspect recent work in ${projectRepo}.` },
      ],
      tools: registry.getModelTools(),
    }, { modelId: 'mock', executionMode: 'local_only', workspaceId: 'profile' }, new AbortController().signal);

    expect(result).toBe('Mapped project evidence inspected.');
    expect(requestLog[1]?.messages.find((message) => message.role === 'tool')?.content)
      .toContain('mapped workspace evidence');
  });
});

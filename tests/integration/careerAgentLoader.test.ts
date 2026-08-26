import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { CareerAgentLoader } from '../../src/application/agents/CareerAgentLoader';
import { ToolRegistry, ToolExecutor, PolicyGate } from '../../src/application/tools';
import { AgentRuntime } from '../../src/application/intelligence';
import { MockIntelligenceAdapter } from '../../src/infrastructure/mock/mockIntelligence';
import { DefaultWorkspaceGateway } from '../../src/infrastructure/filesystem/workspaceGateway';
import { gitLogTool } from '../../src/infrastructure/git/gitTools';

describe('Career Agent loader integration', () => {
  it('loads agent definition from declarative files', () => {
    const agentDir = path.resolve('src/agents/career');
    const loader = new CareerAgentLoader(agentDir);
    const agent = loader.load();

    expect(agent.id).toBe('career');
    expect(agent.name).toBe('Career Agent');
    expect(agent.toolPolicies['git.log']).toBe('allow');
    expect(agent.toolPolicies['filesystem.read']).toBe('allow');
    expect(agent.toolPolicies['filesystem.proposeWrite']).toBe('require_approval');
    expect(agent.systemPrompt).toContain('Evidence-first');
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
    const loader = new CareerAgentLoader(agentDir);
    const agent = loader.load();

    const gateway = new DefaultWorkspaceGateway({ 'test-repo': repo });
    const registry = new ToolRegistry();
    registry.register(gitLogTool);

    const executor = new ToolExecutor(registry);
    const gate = new PolicyGate();

    // Mock intelligence: first call returns a tool_call for git.log, second returns text analysis
    const mockIntelligence = new MockIntelligenceAdapter([
      { type: 'tool_call', call: { toolName: 'git.log', input: { workspaceId: 'test-repo', limit: 5 } } },
      { type: 'text', content: 'Recent work: initial project setup commit found in repository.' },
    ]);

    const runtime = new AgentRuntime(
      mockIntelligence,
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
      },
      { modelId: 'mock', executionMode: 'local_only', workspaceId: 'test-repo' },
      new AbortController().signal,
    );

    expect(result).toContain('Recent work');
  });
});

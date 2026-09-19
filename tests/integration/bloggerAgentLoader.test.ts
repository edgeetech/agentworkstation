import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { CareerAgentLoader } from '../../src/application/agents/CareerAgentLoader';
import { FileSystemAgentDefinitionSource } from '../../src/infrastructure/agents/FileSystemAgentDefinitionSource';

describe('Blogger Agent loader integration', () => {
  it('loads the bounded declarative package with safe workflows and policies', () => {
    const agentDir = path.resolve('src/agents/blogger');
    const loader = new CareerAgentLoader(new FileSystemAgentDefinitionSource(agentDir));
    const agent = loader.load();

    expect(agent.id).toBe('blogger');
    expect(agent.name).toBe('Blogger');

    expect(agent.instructions.map((file) => file.relativePath)).toEqual([
      'AGENT.md',
      'RULES.md',
    ]);
    expect(agent.workflows.map((file) => file.relativePath)).toEqual([
      'workflows/learn-voice.md',
      'workflows/draft-bilingual-post.md',
      'workflows/prepare-visual.md',
      'workflows/prepare-publication.md',
      'workflows/publish-site.md',
      'workflows/share-linkedin.md',
    ]);
    expect(agent.memory.map((file) => file.relativePath)).toEqual([
      'memory/editorial-preferences.md',
      'memory/visual-direction.md',
      'memory/voice-profile.md',
    ]);

    expect(agent.quickActions.map((action) => [action.id, action.workflow])).toEqual([
      ['learn-voice', 'learn-voice'],
      ['draft-bilingual-post', 'draft-bilingual-post'],
      ['prepare-visual', 'prepare-visual'],
      ['prepare-publication', 'prepare-publication'],
      ['publish-site', 'publish-site'],
      ['share-linkedin', 'share-linkedin'],
    ]);

    expect(agent.toolPolicies).toEqual({
      'web.read': 'allow',
      'filesystem.read': 'allow',
      'filesystem.readSharedPath': 'allow',
      'git.log': 'allow',
      'git.status': 'allow',
      'git.diff': 'allow',
      'filesystem.proposeWrite': 'require_approval',
    });

    expect(agent.systemPrompt).toContain('public URLs or local published articles explicitly selected');
    expect(agent.systemPrompt).toContain('Do not produce literal sentence-by-sentence translations');
    expect(agent.systemPrompt).toContain('copyright-safe visual concepts and assets');
    expect(agent.systemPrompt).toContain('Record visual provenance');
    expect(agent.systemPrompt).toContain('configured deployment target');
    expect(agent.systemPrompt).toContain('Publishing requires explicit human approval');
    expect(agent.systemPrompt).toContain('verified successful site publication');
    expect(agent.systemPrompt).toContain('separate explicit approval');
    expect(agent.systemPrompt).toContain('Never perform direct external side effects');
    expect(agent.systemPrompt).toContain('Never run deployment commands');
    expect(agent.systemPrompt).toContain('Never connect an account');
  });
});

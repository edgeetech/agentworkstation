import type { AgentDefinitionSource } from '@application/ports/AgentDefinitionSource';
import type { AgentContentFile, AgentDefinition } from './types';

function renderSection(title: string, files: AgentContentFile[]): string {
  if (files.length === 0) return '';
  const content = files
    .map((file) => `### ${file.relativePath}\n\n${file.content}`)
    .join('\n\n---\n\n');
  return `## ${title}\n\n${content}`;
}

export class CareerAgentLoader {
  constructor(private readonly source: AgentDefinitionSource) {}

  load(): AgentDefinition {
    const materials = this.source.load();
    const systemPrompt = [
      renderSection('Instructions', materials.instructions),
      renderSection('Workflows', materials.workflows),
      renderSection('Career memory', materials.memory),
    ].filter(Boolean).join('\n\n===\n\n');

    return { ...materials, systemPrompt };
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { AgentDefinitionLoader } from '../../application/agents/AgentDefinitionLoader';
import type { AgentDefinition } from '../../application/agents/types';
import { FileSystemAgentDefinitionSource } from './FileSystemAgentDefinitionSource';

const validAgentId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function compareIds(left: AgentDefinition, right: AgentDefinition): number {
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export class FileSystemAgentCatalog {
  private readonly root: string;

  constructor(
    rootDirectory: string,
    private readonly maxMemoryBytes = 64 * 1024,
  ) {
    this.root = fs.realpathSync(rootDirectory);
    if (!fs.statSync(this.root).isDirectory()) {
      throw new Error(`Agent catalog root is not a directory: ${rootDirectory}`);
    }
  }

  list(): AgentDefinition[] {
    const agents = this.agentDirectories()
      .flatMap((agentDirectory) => {
        try {
          return [this.loadDefinition(agentDirectory)];
        } catch {
          return [];
        }
      })
      .sort(compareIds);

    const ids = new Set<string>();
    for (const agent of agents) {
      if (ids.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
      ids.add(agent.id);
    }

    return agents;
  }

  get(id: string): AgentDefinition {
    if (!validAgentId.test(id)) throw new Error(`Invalid agent id: ${id}`);
    const matches = this.agentDirectories().flatMap((agentDirectory) => {
      try {
        const agent = this.loadDefinition(agentDirectory);
        return agent.id === id ? [agent] : [];
      } catch {
        return [];
      }
    });
    if (matches.length > 1) throw new Error(`Duplicate agent id: ${id}`);
    if (!matches[0]) throw new Error(`Unknown agent id: ${id}`);
    return matches[0];
  }

  private agentDirectories(): string[] {
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.root, entry.name))
      .filter((agentDirectory) => this.hasDefinition(agentDirectory));
  }

  private loadDefinition(agentDirectory: string): AgentDefinition {
    const agent = new AgentDefinitionLoader(
      new FileSystemAgentDefinitionSource(agentDirectory),
      this.maxMemoryBytes,
    ).load();
    if (!validAgentId.test(agent.id)) throw new Error(`Invalid agent id: ${agent.id}`);
    return agent;
  }

  private hasDefinition(agentDirectory: string): boolean {
    const definitionPath = path.join(agentDirectory, 'agent.yaml');
    return fs.existsSync(definitionPath) && fs.statSync(definitionPath).isFile();
  }
}

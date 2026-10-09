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

type AgentDirectory = { directory: string; custom: boolean };

export class FileSystemAgentCatalog {
  private readonly root: string;
  private readonly customRoot: string | undefined;

  /**
   * @param rootDirectory specialists shipped with the app.
   * @param customRootDirectory specialists the user created; a built-in id always wins
   *   over a custom agent with the same id.
   */
  constructor(
    rootDirectory: string,
    private readonly maxMemoryBytes = 64 * 1024,
    customRootDirectory?: string,
    /** Holds `<agent folder>/AGENT.md` and `RULES.md` the owner rewrote for shipped specialists. */
    private readonly overridesRoot?: string,
  ) {
    this.root = fs.realpathSync(rootDirectory);
    if (!fs.statSync(this.root).isDirectory()) {
      throw new Error(`Agent catalog root is not a directory: ${rootDirectory}`);
    }
    this.customRoot = customRootDirectory && fs.existsSync(customRootDirectory)
      ? fs.realpathSync(customRootDirectory)
      : undefined;
  }

  list(): AgentDefinition[] {
    const builtIn = this.loadAll(this.directoriesIn(this.root, false));
    const ids = new Set<string>();
    for (const agent of builtIn) {
      if (ids.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
      ids.add(agent.id);
    }
    const custom = this.loadAll(this.customRoot ? this.directoriesIn(this.customRoot, true) : [])
      .filter((agent) => {
        if (ids.has(agent.id)) return false;
        ids.add(agent.id);
        return true;
      });
    return [...builtIn, ...custom].sort(compareIds);
  }

  get(id: string): AgentDefinition {
    if (!validAgentId.test(id)) throw new Error(`Invalid agent id: ${id}`);
    const builtIn = this.loadAll(this.directoriesIn(this.root, false)).filter((agent) => agent.id === id);
    if (builtIn.length > 1) throw new Error(`Duplicate agent id: ${id}`);
    if (builtIn[0]) return builtIn[0];
    const custom = this.customRoot
      ? this.loadAll(this.directoriesIn(this.customRoot, true)).find((agent) => agent.id === id)
      : undefined;
    if (!custom) throw new Error(`Unknown agent id: ${id}`);
    return custom;
  }

  private loadAll(directories: AgentDirectory[]): AgentDefinition[] {
    return directories.flatMap(({ directory, custom }) => {
      try {
        const agent = this.loadDefinition(directory, custom ? undefined : this.overrideDirectoryFor(directory));
        return [custom ? { ...agent, custom: true } : agent];
      } catch {
        return [];
      }
    });
  }

  private directoriesIn(root: string, custom: boolean): AgentDirectory[] {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter((agentDirectory) => this.hasDefinition(agentDirectory))
      .map((directory) => ({ directory, custom }));
  }

  /** Where the owner's rewritten instructions for a shipped specialist live. */
  overrideDirectoryFor(agentDirectory: string): string | undefined {
    return this.overridesRoot ? path.join(this.overridesRoot, path.basename(agentDirectory)) : undefined;
  }

  /** The packaged folder of a shipped specialist, or undefined for one the user created. */
  builtInDirectory(id: string): string | undefined {
    return this.directoriesIn(this.root, false)
      .map(({ directory }) => directory)
      .find((directory) => {
        try {
          return this.loadDefinition(directory).id === id;
        } catch {
          return false;
        }
      });
  }

  private loadDefinition(agentDirectory: string, overrideDirectory?: string): AgentDefinition {
    const agent = new AgentDefinitionLoader(
      new FileSystemAgentDefinitionSource(agentDirectory, overrideDirectory),
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

import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  capabilitiesFrom,
  customAgentIdFor,
  customAgentInputSchema,
  toolPoliciesFor,
  type CustomAgentInput,
} from '../../application/agents/customAgents';
import type { AgentToolPolicy } from '@application/agents/types';

const validAgentId = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Writes user-created specialists in the same declarative format as the built-in ones
 * (agent.yaml, AGENT.md, RULES.md, memory/), one folder per agent under the root.
 */
export class FileSystemCustomAgentStore {
  constructor(private readonly root: string) {}

  create(value: unknown, takenIds: Iterable<string>): string {
    const input = customAgentInputSchema.parse(value);
    fs.mkdirSync(this.root, { recursive: true });
    const onDisk = fs.readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const id = customAgentIdFor(input.name, [...takenIds, ...onDisk]);
    const directory = this.directory(id);
    fs.mkdirSync(path.join(directory, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'memory', 'notes.md'), '# Notes\n\nCurated facts this specialist should remember.\n');
    this.writeDefinition(id, input);
    return id;
  }

  update(id: string, value: unknown): void {
    const input = customAgentInputSchema.parse(value);
    if (!fs.existsSync(path.join(this.directory(id), 'agent.yaml'))) throw new Error(`Unknown custom agent: ${id}`);
    this.writeDefinition(id, input);
  }

  read(id: string): CustomAgentInput {
    const directory = this.directory(id);
    const config = parse(fs.readFileSync(path.join(directory, 'agent.yaml'), 'utf8')) as {
      name: string;
      description: string;
      quickActions?: Array<{ prompt: string }>;
      toolPolicies?: Record<string, AgentToolPolicy>;
      intelligence?: string[];
    };
    const readOptional = (file: string): string => {
      const filePath = path.join(directory, file);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
    };
    return customAgentInputSchema.parse({
      name: config.name,
      description: config.description,
      instructions: readOptional('AGENT.md') || config.description,
      rules: readOptional('RULES.md'),
      starters: (config.quickActions ?? []).map((action) => action.prompt),
      capabilities: capabilitiesFrom(config.toolPolicies ?? {}),
      intelligence: config.intelligence ?? [],
    });
  }

  delete(id: string): void {
    const directory = this.directory(id);
    if (!fs.existsSync(path.join(directory, 'agent.yaml'))) throw new Error(`Unknown custom agent: ${id}`);
    fs.rmSync(directory, { recursive: true, force: true });
  }

  directory(id: string): string {
    if (!validAgentId.test(id)) throw new Error(`Invalid custom agent id: ${id}`);
    return path.join(this.root, id);
  }

  private writeDefinition(id: string, input: CustomAgentInput): void {
    const directory = this.directory(id);
    const instructions = ['AGENT.md', ...(input.rules ? ['RULES.md'] : [])];
    const definition = {
      schemaVersion: 1,
      id,
      name: input.name,
      description: input.description,
      instructions,
      memory: { directory: 'memory' },
      quickActions: input.starters.map((prompt, index) => ({
        id: `starter-${index + 1}`,
        title: prompt.length > 60 ? `${prompt.slice(0, 57)}...` : prompt,
        prompt,
      })),
      toolPolicies: toolPoliciesFor(input.capabilities),
      ...(input.intelligence.length ? { intelligence: input.intelligence } : {}),
    };
    fs.writeFileSync(path.join(directory, 'AGENT.md'), `${input.instructions.trim()}\n`);
    const rulesPath = path.join(directory, 'RULES.md');
    if (input.rules) fs.writeFileSync(rulesPath, `${input.rules.trim()}\n`);
    else fs.rmSync(rulesPath, { force: true });
    fs.writeFileSync(path.join(directory, 'agent.yaml'), stringify(definition));
  }
}

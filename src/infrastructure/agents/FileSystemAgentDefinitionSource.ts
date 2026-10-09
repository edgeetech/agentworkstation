import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AgentDefinitionSource } from '@application/ports/AgentDefinitionSource';
import type { AgentContentFile, AgentDefinitionMaterials } from '@application/agents/types';

const agentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.array(z.string().min(1)),
  workflows: z.array(z.string().min(1)).default([]),
  quickActions: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    prompt: z.string().min(1),
    workflow: z.string().min(1).optional(),
  })).default([]),
  onboarding: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    prompt: z.string().min(1),
    memoryKey: z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/),
    intent: z.enum(['initial', 'publish', 'linkedin']),
    critical: z.boolean(),
    required: z.boolean().optional(),
    optional: z.boolean().optional(),
    extractionHint: z.string().min(1),
  })).default([]),
  memory: z.object({ directory: z.string().min(1) }).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require_approval', 'deny'])),
  intelligence: z.array(z.string().min(1)).optional(),
});

/** The instruction files an owner may rewrite for a shipped specialist. */
export const EDITABLE_INSTRUCTION_FILES = ['AGENT.md', 'RULES.md'] as const;

export class FileSystemAgentDefinitionSource implements AgentDefinitionSource {
  private readonly root: string;

  /**
   * @param overrideDirectory the owner's rewritten instruction files for a shipped
   *   specialist; an editable file found there replaces the packaged one.
   */
  constructor(agentDirectory: string, private readonly overrideDirectory?: string) {
    this.root = fs.realpathSync(agentDirectory);
  }

  load(): AgentDefinitionMaterials {
    const configFile = this.readFile('agent.yaml');
    const config = agentConfigSchema.parse(parse(configFile.content));
    const instructions = config.instructions.map((relativePath) => this.readInstruction(relativePath));
    const workflows = config.workflows.map((relativePath) => this.readFile(relativePath));
    const memory = config.memory ? this.readDirectory(config.memory.directory) : [];

    return {
      id: config.id,
      name: config.name,
      description: config.description,
      instructions,
      workflows,
      memory,
      quickActions: config.quickActions,
      onboarding: config.onboarding,
      toolPolicies: config.toolPolicies,
      ...(config.intelligence?.length ? { intelligence: config.intelligence } : {}),
    };
  }

  private readDirectory(relativeDirectory: string): AgentContentFile[] {
    const directory = this.resolveInsideRoot(relativeDirectory);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => this.readFile(path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private readInstruction(relativePath: string): AgentContentFile {
    if (this.overrideDirectory && (EDITABLE_INSTRUCTION_FILES as readonly string[]).includes(relativePath)) {
      const overridePath = path.join(this.overrideDirectory, relativePath);
      if (fs.existsSync(overridePath) && fs.statSync(overridePath).isFile()) {
        return { relativePath, content: fs.readFileSync(overridePath, 'utf8') };
      }
    }
    return this.readFile(relativePath);
  }

  private readFile(relativePath: string): AgentContentFile {
    const filePath = this.resolveInsideRoot(relativePath);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`Agent content is not a file: ${relativePath}`);
    return { relativePath, content: fs.readFileSync(filePath, 'utf8') };
  }

  private resolveInsideRoot(relativePath: string): string {
    if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
      throw new Error(`Agent content path must be relative: ${relativePath}`);
    }
    const candidate = fs.realpathSync(path.join(this.root, relativePath));
    if (candidate !== this.root && !candidate.startsWith(this.root + path.sep)) {
      throw new Error(`Agent content escapes its directory: ${relativePath}`);
    }
    return candidate;
  }
}

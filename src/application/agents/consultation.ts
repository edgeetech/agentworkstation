import { z } from 'zod';
import type { SourceReference } from '@domain/intelligence';
import type { AgentTool, ToolResult } from '../tools';

/** A specialist as the user currently sees it: display names change, ids do not. */
export type RosterEntry = { id: string; name: string; canonicalName: string };

export type AgentMatch =
  | { kind: 'match'; id: string }
  | { kind: 'ambiguous'; candidates: RosterEntry[] }
  | { kind: 'none' };

export function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves "Saul", "saul goodman", "Accountant" or "saul-goodman" to one specialist.
 * Exact names win over partial ones; more than one candidate is reported, never guessed.
 */
export function resolveAgentByName(query: string, roster: readonly RosterEntry[]): AgentMatch {
  const wanted = normalizeName(query);
  if (!wanted) return { kind: 'none' };
  const keys = (entry: RosterEntry): string[] => [...new Set([entry.name, entry.canonicalName, entry.id].map(normalizeName))];
  const exact = roster.filter((entry) => keys(entry).includes(wanted));
  if (exact.length === 1) return { kind: 'match', id: exact[0]!.id };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };
  const partial = roster.filter((entry) => keys(entry).some((key) =>
    key.split(' ').includes(wanted) || (wanted.length >= 3 && key.startsWith(wanted))));
  if (partial.length === 1) return { kind: 'match', id: partial[0]!.id };
  if (partial.length > 1) return { kind: 'ambiguous', candidates: partial };
  return { kind: 'none' };
}

/**
 * True when a message names another specialist, which is what makes the consult tool
 * available. Name parts match at a word start so Turkish suffixes still count
 * ("Saul'e", "Saule sor").
 */
export function mentionsOtherSpecialist(message: string, roster: readonly RosterEntry[], selfId: string): boolean {
  const text = ` ${normalizeName(message)}`;
  return roster.some((entry) => entry.id !== selfId
    && [entry.name, entry.canonicalName].map(normalizeName).some((name) => (name.length >= 3 && text.includes(` ${name}`))
      || name.split(' ').some((part) => part.length >= 4 && text.includes(` ${part}`))));
}

export type ConsultationAnswer = { agentName: string; answer: string; sourceReferences: SourceReference[]; partial: boolean };

export type ConsultToolOptions = {
  selfId: string;
  roster: readonly RosterEntry[];
  /** Keys of the asking specialist's memory that may be shared by reference. */
  memoryKeys: readonly string[];
  consult: (targetId: string, question: string, memoryRefs: string[], signal: AbortSignal) => Promise<ConsultationAnswer>;
};

export function createConsultTool(options: ConsultToolOptions): AgentTool<{ agent: string; question: string; memoryRefs?: string[] }, ToolResult> {
  const others = options.roster.filter((entry) => entry.id !== options.selfId);
  const rosterLines = others.map((entry) => entry.name === entry.canonicalName
    ? `- ${entry.name}`
    : `- ${entry.name} (${entry.canonicalName})`).join('\n');
  const memoryLine = options.memoryKeys.length
    ? `Your memory keys that can be shared by reference: ${options.memoryKeys.join(', ')}.`
    : 'You have no memory entries to share.';
  return {
    id: 'agents.consult',
    description: [
      'Ask another specialist a question and get its answer. Use only when the user asks you to consult or check with another specialist.',
      'Write a self-contained question. To give it facts from your memory, list their keys in memoryRefs instead of copying the values: it reads them from your memory directly.',
      `Specialists:\n${rosterLines}`,
      memoryLine,
    ].join('\n'),
    inputSchema: z.object({
      agent: z.string().trim().min(1).max(80),
      question: z.string().trim().min(1).max(8_000),
      memoryRefs: z.array(z.string().min(1).max(200)).max(20).optional(),
    }),
    inputJsonSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'The specialist name as the user wrote it' },
        question: { type: 'string' },
        memoryRefs: { type: 'array', items: { type: 'string' }, description: 'Keys of your memory entries the specialist needs' },
      },
      required: ['agent', 'question'],
      additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: false, requiresWorkspace: false, timeoutMs: 300_000 },
    async execute({ agent, question, memoryRefs = [] }, context): Promise<ToolResult> {
      const match = resolveAgentByName(agent, others);
      if (match.kind === 'none') throw new Error(`No specialist called "${agent}". Available: ${others.map((entry) => entry.name).join(', ')}`);
      if (match.kind === 'ambiguous') {
        throw new Error(`"${agent}" matches more than one specialist: ${match.candidates.map((entry) => entry.name).join(', ')}. Ask the user which one.`);
      }
      const unknown = memoryRefs.filter((key) => !options.memoryKeys.includes(key));
      if (unknown.length) throw new Error(`Unknown memory keys: ${unknown.join(', ')}. Available: ${options.memoryKeys.join(', ') || 'none'}`);
      const result = await options.consult(match.id, question, [...new Set(memoryRefs)], context.signal);
      return {
        output: {
          specialist: result.agentName,
          answer: result.answer,
          ...(result.partial ? { note: `${result.agentName} reached its step limit; this answer may be incomplete.` } : {}),
        },
        sourceReferences: result.sourceReferences,
      };
    },
  };
}

/**
 * Lets a consulted specialist read, on demand, only the memory entries the asking
 * specialist referenced. Values are read live from the owner's memory and never copied
 * into the consulted specialist's own memory.
 */
export function createSharedMemoryReadTool(options: {
  ownerName: string;
  read: (key: string) => Promise<string | null>;
  keys: readonly string[];
}): AgentTool<{ key: string }, ToolResult> {
  return {
    id: 'consultation.readSharedMemory',
    description: `Read a memory entry ${options.ownerName} shared with you for this question. Shared keys: ${options.keys.join(', ')}. This is ${options.ownerName}'s memory, not yours; do not save it.`,
    inputSchema: z.object({ key: z.string().min(1).max(200) }),
    inputJsonSchema: {
      type: 'object',
      properties: { key: { type: 'string', enum: [...options.keys] } },
      required: ['key'],
      additionalProperties: false,
    },
    metadata: { readOnly: true, sideEffect: 'none', sensitive: true, requiresWorkspace: false },
    async execute({ key }, context): Promise<ToolResult> {
      context.signal.throwIfAborted();
      if (!options.keys.includes(key)) throw new Error(`${options.ownerName} did not share "${key}"`);
      const value = await options.read(key);
      if (value === null) throw new Error(`${options.ownerName} has no memory entry "${key}"`);
      return { output: { key, value }, sourceReferences: [{ type: 'memory', label: `${options.ownerName}: ${key}` }] };
    },
  };
}

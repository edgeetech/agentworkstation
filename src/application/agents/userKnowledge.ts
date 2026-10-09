import { z } from 'zod';
import type { AgentTool, ToolResult } from '@application/tools';
import type { AgentMemoryEntry, AgentMemoryStore } from '@domain/onboarding';
import type { WorkspaceRegistration } from '@application/workspaces';

/** Prefix for facts a specialist chose to remember about its user. */
export const LEARNED_FACT_PREFIX = 'learned.';
const MAX_LEARNED_FACTS = 60;
const MAX_FACT_LENGTH = 400;

export type AgentFolder = { id: string; rootPath: string; uses: number };

/** Counts the registered folders a specialist's earlier answers drew evidence from, most used first. */
export function summarizeAgentFolders(
  sourceReferenceLists: readonly string[],
  registrations: readonly WorkspaceRegistration[],
  limit = 6,
): AgentFolder[] {
  const counts = new Map<string, number>();
  for (const json of sourceReferenceLists) {
    let references: unknown;
    try {
      references = JSON.parse(json);
    } catch {
      continue;
    }
    if (!Array.isArray(references)) continue;
    for (const reference of references) {
      const workspaceId = (reference as { workspaceId?: unknown })?.workspaceId;
      if (typeof workspaceId === 'string' && workspaceId) counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .flatMap(([id, uses]) => {
      const registration = registrations.find((workspace) => workspace.id === id);
      return registration ? [{ id, rootPath: registration.rootPath, uses }] : [];
    })
    .sort((left, right) => right.uses - left.uses)
    .slice(0, limit);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Specialists exist to answer for this user, not in general. These rules make checking
 * what the specialist knows about the user, and the user's own material, the first step
 * of every answer.
 */
export const USER_KNOWLEDGE_INSTRUCTIONS = [
  '## Know your user',
  "You are this user's own specialist, not a general assistant. They can find general information anywhere; what they need from you is an answer about their situation.",
  'Before answering:',
  '1. Read "What you know about the user" in your memory, and the earlier messages in this conversation.',
  '2. When the question concerns their business, project, documents, or history, look in their own material first: the folders listed in your memory, then the other registered workspaces. List folders, search them, and read the relevant files. Go beyond a README: read plans, notes, records, and history before you conclude.',
  '3. Answer with their facts, figures, names, and file references. Use general rules and web sources only to support or check what their material says, and say so when you do.',
  'A question that says "we", "our", "my", or names their company or project is about their situation, even when it sounds like a general rule. Find their facts (dates, amounts, people, documents) in their material before answering.',
  'Never ask the user for a fact you could find in their memory or folders. Search first; ask only for what is not there, and say where you looked.',
  'If their material does not hold the answer, say what you checked, then answer generally and name the one detail that would make the answer specific.',
  'When you learn something durable about the user that will matter again (a fact about their company, project, people, preferences, or where their material is), save it with memory.remember. Do not save secrets, one-off details, or facts you already know.',
].join('\n');

/** What the specialist knows about its user: setup answers, learned facts, and the folders it has used. */
export function buildUserKnowledgeMemory(input: {
  memory: readonly AgentMemoryEntry[];
  folders: readonly AgentFolder[];
}): string {
  const learned = input.memory.filter((entry) => entry.fieldKey.startsWith(LEARNED_FACT_PREFIX));
  const setup = input.memory.filter((entry) => !entry.fieldKey.startsWith(LEARNED_FACT_PREFIX));
  const lines = ['## What you know about the user'];
  if (setup.length > 0) {
    lines.push('', '### What they told you during setup', ...setup.map((entry) => `- ${entry.fieldKey}: ${describeValue(entry.value)}`));
  }
  if (learned.length > 0) {
    lines.push('', '### What you have learned about them', ...learned.map((entry) => `- ${describeValue(entry.value)}`));
  }
  if (input.folders.length > 0) {
    lines.push(
      '',
      '### Their folders you have worked in',
      ...input.folders.map((folder) => `- workspace ${JSON.stringify(folder.id)} (${folder.rootPath}), used in ${folder.uses} earlier answers`),
    );
  }
  if (lines.length === 1) lines.push('', 'Nothing yet. Use their registered workspaces, and learn as you go.');
  return lines.join('\n');
}

/** Sent back once when a specialist answers without opening any of the user's folders. */
export function groundingCheckMessage(folders: readonly AgentFolder[]): string {
  const where = folders.slice(0, 3).map((folder) => `"${folder.id}"`).join(', ');
  return [
    "(Automatic check, not from the user.) You answered without opening any of the user's own files this turn.",
    `If the question touches their situation, look in their folders now (start with ${where}), find their facts, and give the answer again using them.`,
    'If it is truly general and their material cannot change the answer, repeat your answer as it was.',
  ].join(' ');
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'fact';
}

/** Lets a specialist keep a durable fact about its user across conversations. */
export function createRememberTool(
  store: AgentMemoryStore,
  agentId: string,
  now: () => Date = () => new Date(),
): AgentTool<{ fact: string; topic: string }, ToolResult> {
  return {
    id: 'memory.remember',
    description: 'Save a durable fact about the user for future conversations, such as "Payroll has one employee and one director" or "The Taksim website repo is at C:/Workspace/taksim-website". A fact with the same topic replaces the earlier one.',
    inputSchema: z.object({
      fact: z.string().trim().min(3).max(MAX_FACT_LENGTH),
      topic: z.string().trim().min(2).max(60),
    }),
    inputJsonSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', minLength: 3, maxLength: MAX_FACT_LENGTH, description: 'One self-contained sentence' },
        topic: { type: 'string', minLength: 2, maxLength: 60, description: 'Short label; reuse it to update the fact, e.g. "payroll staff"' },
      },
      required: ['fact', 'topic'],
      additionalProperties: false,
    },
    metadata: { readOnly: false, sideEffect: 'none', sensitive: false },
    async execute({ fact, topic }): Promise<ToolResult> {
      const fieldKey = `${LEARNED_FACT_PREFIX}${slug(topic)}`;
      const existing = (await store.getAgentMemory(agentId)).filter((entry) => entry.fieldKey.startsWith(LEARNED_FACT_PREFIX));
      if (!existing.some((entry) => entry.fieldKey === fieldKey) && existing.length >= MAX_LEARNED_FACTS) {
        return { output: { saved: false, reason: `Memory is full (${MAX_LEARNED_FACTS} facts); update an existing topic instead.` }, sourceReferences: [] };
      }
      const timestamp = now().toISOString();
      await store.saveMemoryEntry({
        agentId,
        fieldKey,
        value: fact,
        provenance: { source: 'agent_learned', questionId: fieldKey, capturedAt: timestamp },
        confidence: 0.9,
        confirmationStatus: 'confirmed',
        confirmedAt: timestamp,
        updatedAt: timestamp,
      });
      return { output: { saved: true, topic: fieldKey }, sourceReferences: [{ type: 'memory', label: fieldKey }] };
    },
  };
}

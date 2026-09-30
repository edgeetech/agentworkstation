import { z } from 'zod';
import type { ModelRequest } from '@domain/intelligence';
import type { AgentToolPolicy } from './types';

export const customAgentCapabilitiesSchema = z.object({
  /** web.search and web.read. */
  webResearch: z.boolean(),
  /** Read files the user shares or registers as workspaces. */
  readFiles: z.boolean(),
  /** Read git history, status and diffs of registered workspaces. */
  gitHistory: z.boolean(),
  /** Propose file changes; each one still needs the user's approval. */
  proposeFileChanges: z.boolean(),
  /** Ask other specialists when the user requests it. */
  consultSpecialists: z.boolean().default(false),
});

export const customAgentInputSchema = z.object({
  name: z.string().trim().min(1).max(48),
  description: z.string().trim().min(1).max(240),
  instructions: z.string().trim().min(1).max(16_000),
  rules: z.string().trim().max(8_000).default(''),
  starters: z.array(z.string().trim().min(1).max(300)).max(4).default([]),
  capabilities: customAgentCapabilitiesSchema,
  /** Empty means every intelligence the user has allowed in Settings. */
  intelligence: z.array(z.string().min(1).max(40)).max(8).default([]),
});

export type CustomAgentCapabilities = z.infer<typeof customAgentCapabilitiesSchema>;
export type CustomAgentInput = z.infer<typeof customAgentInputSchema>;

const TURKISH_LETTERS: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u' };

/** A readable, filesystem-safe id such as "saul-goodman", unique among the taken ids. */
export function customAgentIdFor(name: string, takenIds: Iterable<string>): string {
  const taken = new Set([...takenIds].map((id) => id.toLowerCase()));
  const base = name
    .replace(/[çğıİöşü]/g, (letter) => TURKISH_LETTERS[letter] ?? letter)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'specialist';
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

export function toolPoliciesFor(capabilities: CustomAgentCapabilities): Record<string, AgentToolPolicy> {
  // The deadline calculator reads no data, so every specialist may use it.
  const policies: Record<string, AgentToolPolicy> = { 'accounting.ukDeadlines': 'allow' };
  if (capabilities.webResearch) Object.assign(policies, { 'web.search': 'allow', 'web.read': 'allow' });
  if (capabilities.readFiles) {
    Object.assign(policies, { 'filesystem.read': 'allow', 'filesystem.readSharedPath': 'allow', 'accounting.summarizeLedger': 'allow' });
  }
  if (capabilities.gitHistory) Object.assign(policies, { 'git.log': 'allow', 'git.status': 'allow', 'git.diff': 'allow' });
  if (capabilities.proposeFileChanges) policies['filesystem.proposeWrite'] = 'require_approval';
  if (capabilities.consultSpecialists) policies['agents.consult'] = 'allow';
  return policies;
}

export function capabilitiesFrom(policies: Readonly<Record<string, AgentToolPolicy>>): CustomAgentCapabilities {
  const allowed = (tool: string): boolean => policies[tool] !== undefined && policies[tool] !== 'deny';
  return {
    webResearch: allowed('web.search') || allowed('web.read'),
    readFiles: allowed('filesystem.read') || allowed('filesystem.readSharedPath'),
    gitHistory: allowed('git.log'),
    proposeFileChanges: allowed('filesystem.proposeWrite'),
    consultSpecialists: allowed('agents.consult'),
  };
}

// --- Drafting an agent with the user's own intelligence -------------------------------

export type CustomAgentDraft = {
  description: string;
  instructions: string;
  rules: string;
  starters: string[];
};

const draftSchema = z.object({
  description: z.string().trim().min(1),
  instructions: z.string().trim().min(1),
  rules: z.string().trim().default(''),
  starters: z.array(z.string().trim().min(1)).default([]),
});

export function buildCustomAgentDraftRequest(input: { name: string; brief: string; language: 'tr' | 'en' }): ModelRequest {
  const language = input.language === 'tr' ? 'Turkish' : 'English';
  return {
    messages: [
      {
        role: 'system',
        content: [
          'You design specialist AI agents for Agent Workstation, a desktop app where each specialist is defined by an instructions file and a rules file.',
          'Given the agent name and the user\'s brief, reply with one JSON object and nothing else:',
          '{"description": string, "instructions": string, "rules": string, "starters": string[]}',
          '- description: one sentence, at most 200 characters, saying what the specialist does.',
          '- instructions: Markdown for AGENT.md, starting with "# <name>". Cover the role and expertise, how it works a request end to end (research with tools first, then deliver a complete answer), its tone, and how it formats answers. 150-400 words.',
          '- rules: Markdown bullet list for RULES.md with 4-8 hard rules, including honest limits of the domain (for example "not a substitute for a licensed professional" where that applies) and never inventing facts or sources.',
          '- starters: 3 or 4 short example requests the user could send.',
          `Write every field in ${language}. Do not wrap the JSON in code fences.`,
        ].join('\n'),
      },
      { role: 'user', content: `Agent name: ${input.name}\n\nBrief:\n${input.brief}` },
    ],
    tools: [],
  };
}

export function parseCustomAgentDraft(raw: string): CustomAgentDraft {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not return an agent draft');
  const draft = draftSchema.parse(JSON.parse(text.slice(start, end + 1)));
  return {
    description: draft.description.slice(0, 240),
    instructions: draft.instructions,
    rules: draft.rules,
    starters: draft.starters.slice(0, 4).map((starter) => starter.slice(0, 300)),
  };
}

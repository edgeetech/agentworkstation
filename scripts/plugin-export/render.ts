import path from 'node:path';
import type { AgentContentFile, AgentDefinitionMaterials, AgentQuickAction } from '../../src/application/agents/types';
import { onboardingTranslations } from './onboardingTranslations';

export type PluginMeta = { category: string; keywords: string[] };

const REPO_URL = 'https://github.com/edgeetech/agentworkstation';
const AUTHOR = { name: 'EdgeeTech', url: 'https://edgee.tech' };

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function trimmedBody(text: string): string {
  return normalizeNewlines(text).trim();
}

/** Shifts every ATX heading (`#`..`######`) in `markdown` down by `delta` levels, so a workflow's own `#` title nests correctly under a wrapper section. */
function demoteHeadings(markdown: string, delta: number): string {
  return trimmedBody(markdown)
    .split('\n')
    .map((line) => {
      const match = /^(#{1,6})(\s+.*)$/.exec(line);
      if (!match) return line;
      return `${'#'.repeat(Math.min(match[1]!.length + delta, 6))}${match[2]}`;
    })
    .join('\n');
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const line = normalizeNewlines(markdown).split('\n').find((entry) => entry.trim().length > 0);
  if (!line) return fallback;
  return line.replace(/^#+\s*/, '').trim() || fallback;
}

function firstDescriptiveLine(markdown: string): string | null {
  const lines = normalizeNewlines(markdown)
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (lines.length < 2) return null;
  return lines[1]!.replace(/^#+\s*/, '').trim() || null;
}

function yamlDoubleQuoted(value: string): string {
  return JSON.stringify(value);
}

function buildSkillDescription(materials: AgentDefinitionMaterials): string {
  const actions = materials.quickActions.map((action) => action.title).join('; ');
  const suffix = actions.length > 0 ? ` Use for: ${actions}.` : '';
  return `${materials.description}${suffix}`;
}

function buildAllowedTools(toolPolicies: Record<string, string>): string {
  const present = new Set(Object.keys(toolPolicies));
  const tools: string[] = [];
  if (present.has('filesystem.read') || present.has('filesystem.readSharedPath')) tools.push('Read', 'Grep', 'Glob');
  if (present.has('web.read')) tools.push('WebFetch');
  if (present.has('git.log')) tools.push('Bash(git log *)');
  if (present.has('git.status')) tools.push('Bash(git status *)');
  if (present.has('git.diff')) tools.push('Bash(git diff *)');
  if (present.has('accounting.ukDeadlines') || present.has('accounting.summarizeLedger')) tools.push('Bash(node *)');
  return tools.join(' ');
}

function buildToolsSection(toolPolicies: Record<string, string>): string {
  const present = new Set(Object.keys(toolPolicies));
  const lines: string[] = [];
  if (present.has('accounting.ukDeadlines')) {
    lines.push(
      '- `accounting.ukDeadlines` -> run '
      + '`node "${CLAUDE_SKILL_DIR}/scripts/uk-deadlines.mjs" --period-end YYYY-MM-DD [--vat-stagger 1|2|3] '
      + '[--confirmation YYYY-MM-DD] [--payroll] [--horizon N] [--today YYYY-MM-DD]`. '
      + 'Never calculate a statutory filing or payment date by hand.',
    );
  }
  if (present.has('accounting.summarizeLedger')) {
    lines.push(
      '- `accounting.summarizeLedger` -> run '
      + '`node "${CLAUDE_SKILL_DIR}/scripts/summarize-ledger.mjs" <file.csv> [--date-column X] [--amount-column X] '
      + '[--debit-column X] [--credit-column X] [--group-by X]`. '
      + 'Never total a ledger export by hand.',
    );
  }
  if (present.has('web.read')) {
    lines.push('- `web.read` -> WebFetch.');
  }
  if (present.has('filesystem.read') || present.has('filesystem.readSharedPath')) {
    lines.push('- `filesystem.read` / `filesystem.readSharedPath` -> Read.');
  }
  if (present.has('git.log') || present.has('git.status') || present.has('git.diff')) {
    lines.push('- `git.log` / `git.status` / `git.diff` -> Bash (`git log`, `git status`, `git diff`).');
  }
  if (present.has('filesystem.proposeWrite')) {
    lines.push('- `filesystem.proposeWrite` -> show the exact diff and ask before editing any file.');
  }
  return lines.length > 0 ? lines.join('\n') : '_No tools declared._';
}

function buildOnboardingSection(materials: AgentDefinitionMaterials): string {
  const questions = materials.onboarding ?? [];
  if (questions.length === 0) return '_No onboarding questions declared._';
  return questions
    .map((question, index) => {
      const translation = onboardingTranslations[question.id];
      if (!translation) throw new Error(`Missing English translation for onboarding question: ${question.id}`);
      const optional = question.required === false || question.optional === true;
      const tags = [question.intent, optional ? 'optional' : 'required'].join(', ');
      return `${index + 1}. **${question.memoryKey}** (${tags}) — ${translation}`;
    })
    .join('\n');
}

function buildMemorySection(memory: AgentContentFile[]): string {
  if (memory.length === 0) return '_No memory files declared._';
  return memory
    .map((file) => {
      const fileName = path.posix.basename(file.relativePath);
      const title = titleFromMarkdown(file.content, fileName);
      const summary = firstDescriptiveLine(file.content);
      return `- [${title}](references/${fileName})${summary ? ` — ${summary}` : ''}`;
    })
    .join('\n');
}

export function buildSkillMarkdown(materials: AgentDefinitionMaterials): string {
  const agentMd = materials.instructions.find((file) => file.relativePath === 'AGENT.md');
  const rulesMd = materials.instructions.find((file) => file.relativePath === 'RULES.md');
  if (!agentMd || !rulesMd) throw new Error(`Agent ${materials.id} must declare AGENT.md and RULES.md instructions`);

  const workflowsSection = materials.workflows.length > 0
    ? materials.workflows.map((file) => demoteHeadings(file.content, 2)).join('\n\n')
    : '_No workflows declared._';

  const sections = [
    `# ${materials.name}`,
    demoteHeadings(agentMd.content, 1),
    demoteHeadings(rulesMd.content, 1),
    `## Workflows\n\n${workflowsSection}`,
    `## Before you start\n\n${buildOnboardingSection(materials)}`,
    `## Tools\n\n${buildToolsSection(materials.toolPolicies)}`,
    `## Memory\n\n${buildMemorySection(materials.memory)}`,
  ];

  const frontmatter = [
    '---',
    `name: ${materials.id}`,
    `description: ${yamlDoubleQuoted(buildSkillDescription(materials))}`,
    `allowed-tools: ${buildAllowedTools(materials.toolPolicies)}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${sections.join('\n\n')}\n`;
}

export function buildCommandMarkdown(action: AgentQuickAction, agentId: string): string {
  const frontmatter = ['---', `description: ${yamlDoubleQuoted(action.title)}`, '---'].join('\n');
  const body = action.workflow
    ? `${action.prompt}\n\nFollow the \`${action.workflow}\` workflow from the ${agentId} skill.`
    : action.prompt;
  return `${frontmatter}\n\n${body}\n`;
}

export function buildPluginJson(materials: AgentDefinitionMaterials, version: string, meta: PluginMeta): string {
  const json = {
    name: materials.id,
    displayName: materials.name,
    version,
    description: materials.description,
    author: AUTHOR,
    homepage: REPO_URL,
    repository: REPO_URL,
    keywords: meta.keywords,
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export type MarketplaceEntry = { id: string; description: string; category: string };

export function buildMarketplaceJson(entries: MarketplaceEntry[], version: string): string {
  const json = {
    name: 'agent-workstation',
    owner: AUTHOR,
    description: 'Agent Workstation specialists packaged as a Claude Code and Claude Cowork plugin marketplace: '
      + 'one declarative agent definition, usable in both runtimes.',
    plugins: entries.map((entry) => ({
      name: entry.id,
      source: `./plugins/${entry.id}`,
      description: entry.description,
      version,
      category: entry.category,
    })),
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

export function normalizeMemoryFile(content: string): string {
  const normalized = normalizeNewlines(content).replace(/\s+$/, '');
  return `${normalized}\n`;
}

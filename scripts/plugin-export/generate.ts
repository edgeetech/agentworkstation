import fs from 'node:fs';
import path from 'node:path';
import { FileSystemAgentDefinitionSource } from '../../src/infrastructure/agents/FileSystemAgentDefinitionSource';
import { bundleCliScript } from './bundleCli';
import { buildCommandMarkdown, buildMarketplaceJson, buildPluginJson, buildSkillMarkdown, normalizeMemoryFile } from './render';
import type { MarketplaceEntry, PluginMeta } from './render';

export type GeneratedFile = { relativePath: string; content: string };

const PLUGIN_META: Record<string, PluginMeta> = {
  accountant: {
    category: 'finance',
    keywords: ['accounting', 'bookkeeping', 'uk-tax', 'vat', 'corporation-tax', 'companies-house'],
  },
  blogger: {
    category: 'writing',
    keywords: ['blogging', 'content', 'bilingual', 'publishing', 'editorial'],
  },
  career: {
    category: 'productivity',
    keywords: ['career', 'cv', 'resume', 'professional-profile'],
  },
};

function readVersion(repoRoot: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  return packageJson.version;
}

function agentDirectories(repoRoot: string): string[] {
  const agentsRoot = path.join(repoRoot, 'src', 'agents');
  return fs.readdirSync(agentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(agentsRoot, entry.name))
    .filter((agentDirectory) => fs.existsSync(path.join(agentDirectory, 'agent.yaml')));
}

export function generatePluginArtifacts(repoRoot: string): GeneratedFile[] {
  const version = readVersion(repoRoot);
  const materialsList = agentDirectories(repoRoot)
    .map((agentDirectory) => new FileSystemAgentDefinitionSource(agentDirectory).load())
    .sort((left, right) => left.id.localeCompare(right.id));

  const files: GeneratedFile[] = [];
  const marketplaceEntries: MarketplaceEntry[] = [];

  for (const materials of materialsList) {
    const meta = PLUGIN_META[materials.id];
    if (!meta) throw new Error(`No plugin metadata (category/keywords) declared for agent: ${materials.id}`);

    const pluginRoot = `plugins/${materials.id}`;
    const skillRoot = `${pluginRoot}/skills/${materials.id}`;

    files.push({ relativePath: `${pluginRoot}/.claude-plugin/plugin.json`, content: buildPluginJson(materials, version, meta) });
    files.push({ relativePath: `${skillRoot}/SKILL.md`, content: buildSkillMarkdown(materials) });

    for (const memoryFile of materials.memory) {
      const fileName = path.posix.basename(memoryFile.relativePath);
      files.push({ relativePath: `${skillRoot}/references/${fileName}`, content: normalizeMemoryFile(memoryFile.content) });
    }

    for (const action of materials.quickActions) {
      files.push({ relativePath: `${pluginRoot}/commands/${action.id}.md`, content: buildCommandMarkdown(action, materials.id) });
    }

    if (materials.id === 'accountant') {
      files.push({
        relativePath: `${skillRoot}/scripts/uk-deadlines.mjs`,
        content: bundleCliScript(path.join(repoRoot, 'scripts/plugin-export/cli-uk-deadlines.ts')),
      });
      files.push({
        relativePath: `${skillRoot}/scripts/summarize-ledger.mjs`,
        content: bundleCliScript(path.join(repoRoot, 'scripts/plugin-export/cli-summarize-ledger.ts')),
      });
    }

    marketplaceEntries.push({ id: materials.id, description: materials.description, category: meta.category });
  }

  files.push({ relativePath: '.claude-plugin/marketplace.json', content: buildMarketplaceJson(marketplaceEntries, version) });

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function writeGeneratedFiles(repoRoot: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const absolutePath = path.join(repoRoot, ...file.relativePath.split('/'));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content, 'utf8');
  }
}

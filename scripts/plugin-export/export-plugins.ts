import path from 'node:path';
import { generatePluginArtifacts, writeGeneratedFiles } from './generate';
import { writeReleaseZips } from './zip';

const repoRoot = path.resolve(__dirname, '..', '..');
const files = generatePluginArtifacts(repoRoot);
writeGeneratedFiles(repoRoot, files);

const pluginCount = new Set(
  files.map((file) => /^plugins\/([^/]+)\//.exec(file.relativePath)?.[1]).filter(Boolean),
).size;
console.log(`Generated ${files.length} files for ${pluginCount} plugin(s) under plugins/ and .claude-plugin/marketplace.json.`);

if (process.argv.includes('--zip')) {
  const zipPaths = writeReleaseZips(repoRoot, files);
  for (const zipPath of zipPaths) console.log(`Wrote ${path.relative(repoRoot, zipPath)}`);
}

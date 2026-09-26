import fs from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import type { GeneratedFile } from './generate';

/** Packs each plugin's own files (relative to its `plugins/<id>/` root) into `release/plugins/<id>.zip`, for Cowork's manual plugin upload. */
export function writeReleaseZips(repoRoot: string, files: GeneratedFile[]): string[] {
  const pluginIds = new Set(
    files
      .map((file) => /^plugins\/([^/]+)\//.exec(file.relativePath)?.[1])
      .filter((id): id is string => Boolean(id)),
  );

  const outputDir = path.join(repoRoot, 'release', 'plugins');
  fs.mkdirSync(outputDir, { recursive: true });

  const written: string[] = [];
  for (const pluginId of [...pluginIds].sort()) {
    const prefix = `plugins/${pluginId}/`;
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
      if (!file.relativePath.startsWith(prefix)) continue;
      entries[file.relativePath.slice(prefix.length)] = strToU8(file.content);
    }
    const archive = zipSync(entries, { level: 9 });
    const outputPath = path.join(outputDir, `${pluginId}.zip`);
    fs.writeFileSync(outputPath, archive);
    written.push(outputPath);
  }
  return written;
}

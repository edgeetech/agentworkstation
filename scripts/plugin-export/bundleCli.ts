import * as esbuild from 'esbuild';

/** Bundles a standalone TS CLI entry (plus its `src/domain/*` imports) into a single ESM file with no runtime dependency on the rest of the repo. */
export function bundleCliScript(entryFile: string): string {
  const result = esbuild.buildSync({
    entryPoints: [entryFile],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    write: false,
    legalComments: 'none',
    minify: false,
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced no output for ${entryFile}`);
  return output.text.endsWith('\n') ? output.text : `${output.text}\n`;
}

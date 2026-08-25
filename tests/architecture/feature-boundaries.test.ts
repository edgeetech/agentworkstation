import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe('feature boundaries', () => {
  it('application does not import electron or react', () => {
    for (const file of walk(path.resolve('src/application'))) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/electron|react/i);
    }
  });
});


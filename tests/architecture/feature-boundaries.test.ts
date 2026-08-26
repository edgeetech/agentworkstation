import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('feature boundaries', () => {
  it('application layer does not import electron or React', () => {
    const appFiles = walk(path.resolve('src/application'))
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
    for (const file of appFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/from ['"]electron/);
      expect(content, file).not.toMatch(/from ['"]react/);
    }
  });

  it('domain layer contains no side-effectful imports', () => {
    const domainFiles = walk(path.resolve('src/domain'))
      .filter((f) => f.endsWith('.ts'));
    for (const file of domainFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(/from ['"]node:/);
      expect(content, file).not.toMatch(/require\(/);
    }
  });
});


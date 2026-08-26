import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? files(p) : [p];
});

describe('architecture boundaries', () => {
  it('domain does not import infrastructure', () => {
    const domainFiles = files(path.join(root, 'src/domain'));
    for (const file of domainFiles) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content).not.toMatch(/from ['"]@infrastructure\//);
    }
  });
});


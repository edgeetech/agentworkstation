import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function readSources(dir: string): Array<{ file: string; content: string }> {
  return walk(path.join(root, dir))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }));
}

describe('architecture boundaries', () => {
  it('domain does not import application, infrastructure, electron, or provider libraries', () => {
    for (const { file, content } of readSources('src/domain')) {
      expect(content, file).not.toMatch(/from ['"]@application\//);
      expect(content, file).not.toMatch(/from ['"]@infrastructure\//);
      expect(content, file).not.toMatch(/from ['"]node:/);
      expect(content, file).not.toMatch(/from ['"]electron/);
      expect(content, file).not.toMatch(/from ['"]ollama/);
    }
  });

  it('application does not import infrastructure, electron, or provider SDKs', () => {
    for (const { file, content } of readSources('src/application')) {
      expect(content, file).not.toMatch(/from ['"]@infrastructure\//);
      expect(content, file).not.toMatch(/from ['"]node:/);
      expect(content, file).not.toMatch(/from ['"]electron/);
      expect(content, file).not.toMatch(/from ['"]ollama/);
      expect(content, file).not.toMatch(/from ['"]openai/);
      expect(content, file).not.toMatch(/from ['"]@langchain\//);
      expect(content, file).not.toMatch(/from ['"]@neox\//);
    }
  });

  it('application does not use relative imports to reach infrastructure', () => {
    for (const { file, content } of readSources('src/application')) {
      // relative imports going up more than one level toward infrastructure
      expect(content, file).not.toMatch(/from ['"]\.\.\/(\.\.\/)?infrastructure\//);
    }
  });

  it('infrastructure does not import electron renderer', () => {
    for (const { file, content } of readSources('src/infrastructure')) {
      expect(content, file).not.toMatch(/from ['"]electron\/renderer/);
    }
  });
});


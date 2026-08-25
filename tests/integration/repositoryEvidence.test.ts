import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

describe('repository evidence demo', () => {
  it('reads recent git history from a real repo', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-git-'));
    execFileSync('git', ['init'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'hello');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'Initial README'], { cwd: repo });
    const log = execFileSync('git', ['-C', repo, 'log', '--oneline', '-1'], { encoding: 'utf8' });
    expect(log).toContain('Initial README');
  });
});


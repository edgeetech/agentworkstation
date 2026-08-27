import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test.skip(process.env.AW_RUN_OLLAMA_ACCEPTANCE !== '1', 'Run explicitly against a locally installed Ollama model');
test.setTimeout(240_000);

function createRepo(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ollama-profile-'));
  execFileSync('git', ['init'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: directory });
  fs.writeFileSync(path.join(directory, 'README.md'), '# Test profile\n\nSoftware architect.\n');
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'feat: create professional profile'], { cwd: directory });
  return directory;
}

test('Career Agent reaches a real Ollama model through the desktop UI', async () => {
  const profileRepo = createRepo();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ollama-appdata-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve('.'),
    env: { ...process.env, AW_RENDERER_MODE: 'file', AW_USER_DATA_PATH: userData },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, workspacePath: string) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspacePath] });
    }, profileRepo);

    await page.locator('nav').getByRole('button', { name: /Workspaces/ }).click();
    await page.getByLabel('Workspace name').fill('profile');
    await page.getByLabel('Purpose').selectOption('profile');
    await page.getByRole('button', { name: 'Choose folder and add' }).click();
    await expect(page.locator('.workspace').filter({ hasText: 'profile' })).toBeVisible();

    await page.getByRole('button', { name: /Model settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Model Settings' })).toBeVisible();
    await page.getByLabel('Execution mode').selectOption('local');
    await page.getByText('Ollama connection details', { exact: true }).click();
    await page.getByLabel('Endpoint URL').fill('http://localhost:11434');
    await page.getByRole('button', { name: 'Refresh installed models' }).click();
    const discoveredModel = page.getByLabel('Installed Ollama model');
    await expect(discoveredModel).toBeVisible({ timeout: 30_000 });
    await discoveredModel.selectOption('qwen2.5:3b');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Verified local model qwen2.5:3b. Requests cannot use cloud providers.')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Save model settings' }).click();

    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await page.getByLabel('Message Career Agent').fill('In one sentence, what is this profile about?');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await sendButton.click();
    await expect(sendButton).toBeDisabled();
    await expect(page.getByLabel('Career Agent is thinking')).toBeVisible();
    const answer = page.locator('.message.assistant').last();
    await expect(answer).toBeVisible({ timeout: 90_000 });
    await expect(answer).not.toContainText('Mock response:');
    await expect(answer.getByText('Local route')).toBeVisible();
    await expect(answer).toContainText('Local only kept this request on this device.');

    await page.locator('nav').getByRole('button', { name: /Career audit/ }).click();
    await page.getByRole('button', { name: 'Run career audit' }).click();
    await expect(page.getByText('Career audit completed.')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.agent-output')).not.toContainText('Mock response:');
    await expect(page.getByText('Local route').last()).toBeVisible();
    await expect(page.locator('.source-row').first()).toBeVisible();
    await expect(page.locator('.source-row').filter({ hasText: 'README.md' })).toHaveCount(1);

    await page.locator('nav').getByRole('button', { name: /Review changes/ }).click();
    await page.getByLabel('Requested improvement').fill('Add this exact sentence: Works with local-first AI systems.');
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.change pre')).toContainText('Works with local-first AI systems.');
  } finally {
    await app.close();
  }
});

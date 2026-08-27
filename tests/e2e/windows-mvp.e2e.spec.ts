import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function createRepo(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  execFileSync('git', ['init'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: directory });
  fs.writeFileSync(path.join(directory, 'README.md'), `# ${name}\n\ninitial\n`);
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync('git', ['commit', '-m', `init ${name}`], { cwd: directory });
  return directory;
}

test('Windows MVP critical path is usable through the Electron UI', async () => {
  const profileRepo = createRepo('profile-repo');
  const projectRepo = createRepo('project-repo');
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-appdata-'));
  const launch = async () => electron.launch({
    args: ['.'], cwd: path.resolve('.'),
    env: {
      ...process.env,
      AW_RENDERER_MODE: 'file',
      AW_USER_DATA_PATH: appDataRoot,
      AW_MOCK_RESPONSE_DELAY_MS: '300',
    },
  });

  const firstRun = await launch();
  try {
    const page = await firstRun.firstWindow();
    expect(await firstRun.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();
    await expect(page.getByText('Agent Workstation').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Turn real project work/ })).toBeVisible();
    await page.locator('.agent-picker').click();
    await expect(page.getByRole('heading', { name: 'Choose an agent' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Career Agent' }).click();

    // The native folder chooser cannot be operated by Playwright. Stub only the
    // Electron dialog result; workspace registration still uses visible controls.
    await firstRun.evaluate(({ dialog }, paths: string[]) => {
      let nextPath = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[nextPath++]] });
    }, [profileRepo, projectRepo]);

    await page.locator('nav').getByRole('button', { name: /Workspaces/ }).click();
    const nameInput = page.getByLabel('Workspace name');
    await nameInput.fill('profile');
    await page.getByLabel('Purpose').selectOption('profile');
    await page.getByRole('button', { name: 'Choose folder and add' }).click();
    await expect(page.getByRole('heading', { name: 'profile', exact: true })).toBeVisible();
    await nameInput.fill('project');
    await page.getByLabel('Purpose').selectOption('project');
    await page.getByRole('button', { name: 'Choose folder and add' }).click();
    await expect(page.getByRole('heading', { name: 'project', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Model settings/ }).click();
    await page.getByLabel('Execution mode').selectOption('mock');
    await page.getByRole('button', { name: 'Save model settings' }).click();
    await expect(page.getByText('Simulated demo is not AI.')).toBeVisible();
    await page.getByRole('button', { name: 'Enable simulated demo for this session' }).click();
    await expect(page.getByText('Simulated demo enabled for this session. No AI model will be used.')).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await page.getByLabel('Message Career Agent').fill('What changed that should appear in my profile?');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await sendButton.click();
    await expect(sendButton).toBeDisabled();
    await expect(page.getByLabel('Career Agent is thinking')).toBeVisible();
    await expect(page.getByText(/Mock response:/).first()).toBeVisible();
    await expect(page.getByText('Simulation').first()).toBeVisible();
    await expect(page.getByText(/no AI model was used/i).first()).toBeVisible();
    const conversationSidebar = page.getByRole('complementary', { name: 'Career Agent conversations' });
    await expect(conversationSidebar).toBeVisible();
    await conversationSidebar.getByLabel('New conversation').fill('Second conversation');
    await conversationSidebar.getByRole('button', { name: 'Create' }).click();
    await expect(conversationSidebar.getByRole('button', { name: /Second conversation/ })).toHaveAttribute('aria-current', 'true');
    await conversationSidebar.getByRole('button', { name: /Career Agent Session/ }).click();
    await expect(page.getByText('What changed that should appear in my profile?', { exact: true })).toBeVisible();
    const longPrompt = `Scroll marker ${'career evidence '.repeat(180)}`;
    await page.getByLabel('Message Career Agent').fill(longPrompt);
    await sendButton.click();
    await expect(page.getByText(`Mock response: ${longPrompt}`, { exact: true })).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Career audit/ }).click();
    await page.getByRole('button', { name: 'Run career audit' }).click();
    await expect(page.getByText('Career audit completed.')).toBeVisible();
    await expect(page.getByText(/Mock response:/).last()).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Review changes/ }).click();
    await page.getByLabel('Profile workspace').selectOption('profile');
    await page.getByLabel('Requested improvement').fill('Updated summary from e2e proposal');
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
    await expect(page.locator('pre')).toContainText('Updated summary from e2e proposal');
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const page = await secondRun.firstWindow();
    await expect(page.getByText('Real local model required')).toBeVisible();
    await expect(page.getByText('Simulated demo is configured but inactive')).toBeVisible();
    await page.locator('nav').getByRole('button', { name: /Workspaces/ }).click();
    await expect(page.getByRole('heading', { name: 'profile', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'project', exact: true })).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await expect(page.getByText('What changed that should appear in my profile?', { exact: true })).toBeVisible();
    await expect(page.getByText('Simulation').first()).toBeVisible();
    await expect.poll(async () => page.locator('.conversation').evaluate((element) =>
      element.scrollHeight - element.scrollTop - element.clientHeight,
    )).toBeLessThan(3);

    await page.locator('nav').getByRole('button', { name: /Review changes/ }).click();
    await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
    await expect(page.getByText('Simulation').last()).toBeVisible();
    await page.getByRole('button', { name: 'Approve and write' }).click();
    await expect(page.getByText('No changes waiting')).toBeVisible();
    expect(fs.readFileSync(path.join(profileRepo, 'README.md'), 'utf8')).toContain('Updated summary from e2e proposal');
  } finally {
    await secondRun.close();
  }
});

test('provider usage limits are shown inside the chat transcript', async () => {
  const workspace = createRepo('quota-profile');
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-quota-appdata-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      AW_RENDERER_MODE: 'file',
      AW_USER_DATA_PATH: appDataRoot,
      AW_MOCK_RESPONSE_DELAY_MS: '150',
      AW_MOCK_RESPONSE_ERROR: 'HTTP 429: you (asozyurt) have reached your session usage limit',
    },
  });

  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, workspacePath: string) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspacePath] });
    }, workspace);
    await page.locator('nav').getByRole('button', { name: /Workspaces/ }).click();
    await page.getByLabel('Workspace name').fill('profile');
    await page.getByLabel('Purpose').selectOption('profile');
    await page.getByRole('button', { name: 'Choose folder and add' }).click();
    await expect(page.getByRole('heading', { name: 'profile', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Model settings/ }).click();
    await page.getByLabel('Execution mode').selectOption('mock');
    await page.getByRole('button', { name: 'Save model settings' }).click();
    await page.getByRole('button', { name: 'Enable simulated demo for this session' }).click();
    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await page.getByLabel('Message Career Agent').fill('Review my profile.');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await sendButton.click();

    const transcriptError = page.getByRole('alert').filter({ hasText: 'Usage limit reached' });
    await expect(transcriptError).toBeVisible();
    await expect(transcriptError).toContainText('HTTP 429: you (asozyurt) have reached your session usage limit');
    await expect(page.getByText('Review my profile.', { exact: true })).toBeVisible();
    await expect(sendButton).toBeEnabled();
    await expect(page.locator('.toast.error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

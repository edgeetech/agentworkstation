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

test('keeps a separate unsent draft for every agent conversation', async () => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-drafts-'));
  const app = await electron.launch({
    args: ['.'], cwd: path.resolve('.'),
    env: {
      ...process.env,
      AW_RENDERER_MODE: 'file',
      AW_USER_DATA_PATH: appDataRoot,
    },
  });
  try {
    const page = await app.firstWindow();
    const sidebar = page.getByRole('complementary', { name: 'Specialist workspace navigation' });
    const careerComposer = page.getByLabel('Message Career');
    await careerComposer.fill('Career için gönderilmemiş not');

    await sidebar.getByRole('button', { name: 'Open Blogger' }).click();
    const bloggerComposer = page.getByLabel('Message Blogger');
    await expect(bloggerComposer).toHaveValue('');
    await bloggerComposer.fill('Blogger için gönderilmemiş not');

    await sidebar.getByRole('button', { name: 'Open Career' }).click();
    await expect(page.getByLabel('Message Career')).toHaveValue('Career için gönderilmemiş not');
    await sidebar.getByRole('button', { name: 'Open Blogger' }).click();
    await expect(page.getByLabel('Message Blogger')).toHaveValue('Blogger için gönderilmemiş not');
  } finally {
    await app.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  }
});

test('keeps chat controls compact while exposing mode and context actions', async () => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-composer-'));
  const app = await electron.launch({
    args: ['.'], cwd: path.resolve('.'),
    env: { ...process.env, AW_RENDERER_MODE: 'file', AW_USER_DATA_PATH: appDataRoot },
  });
  try {
    const page = await app.firstWindow();
    const composer = page.locator('.composer-dock');
    await expect(composer.getByLabel('Message Career')).toBeVisible();
    await expect(composer.getByLabel('Add context')).toBeVisible();
    await composer.locator('.composer-mode').click();
    await expect(composer.getByText('Handle safe, read-only steps and ask only when needed.')).toBeVisible();
    await composer.getByRole('button', { name: /Standard.*Answer directly/ }).click();
    await expect(composer.locator('.composer-mode')).toContainText('Standard');
    await composer.getByLabel('Add context').click();
    await expect(composer.getByRole('button', { name: 'Edit agent memory JSON' })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  }
});

test('continues normal conversation without requiring a workspace', async () => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-no-workspace-'));
  const app = await electron.launch({
    args: ['.'], cwd: path.resolve('.'),
    env: {
      ...process.env,
      AW_RENDERER_MODE: 'file',
      AW_USER_DATA_PATH: appDataRoot,
      AW_MOCK_RESPONSE_DELAY_MS: '1800',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.locator('.settings-link').click();
    await page.getByText('Offline demo for testing').click();
    await page.getByRole('button', { name: 'Configure simulated demo' }).click();
    await page.getByRole('button', { name: 'Save intelligence access' }).click();
    await page.getByRole('button', { name: 'Enable simulated demo for this session' }).click();
    const sidebar = page.getByRole('complementary', { name: 'Specialist workspace navigation' });
    await sidebar.getByRole('button', { name: 'Open Blogger' }).click();
    await expect(page.getByLabel('Message Blogger')).toBeVisible();
    await sidebar.getByRole('button', { name: 'Open Career' }).click();
    await page.getByRole('button', { name: /Career chat/ }).click();
    await page.locator('.composer-dock').getByLabel('Add context').click();
    await expect(page.getByRole('button', { name: 'Add folder' })).toBeVisible();

    const composer = page.getByLabel('Message Career');
    await composer.fill('https://github.com/asozyurt');
    await composer.press('Enter');
    await page.getByRole('button', { name: 'Yes, remember this' }).click();
    await composer.fill('no');
    await composer.press('Enter');
    await composer.fill('Let us continue without local files.');
    await composer.press('Enter');
    await sidebar.getByRole('button', { name: 'Open Blogger' }).click();
    await expect(page.getByLabel('Message Blogger')).toBeVisible();
    await sidebar.getByRole('button', { name: 'Open Career' }).click();
    await expect(page.getByText('Let us continue without local files.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Career is thinking')).toBeVisible();

    await expect(page.getByText('Mock response: Let us continue without local files.', { exact: true })).toBeVisible();
    await expect(page.getByText('No workspace configured', { exact: true })).toHaveCount(0);
    await expect(page.locator('.message.user').last()).toHaveCSS('background-color', 'rgb(236, 238, 241)');
  } finally {
    await app.close();
    fs.rmSync(appDataRoot, { recursive: true, force: true });
  }
});

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
      AW_MOCK_RESPONSE_DELAY_MS: '1200',
      AW_LINKEDIN_MOCK: '1',
      AW_E2E_FAKE_PROVIDERS: '1',
    },
  });

  const firstRun = await launch();
  try {
    const page = await firstRun.firstWindow();
    expect(await firstRun.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();
    await expect(page.getByText('Agent Workstation').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /What should I use as sources for your CV/ })).toBeVisible();
    const sidebar = page.getByRole('complementary', { name: 'Specialist workspace navigation' });
    await expect(sidebar.getByRole('button', { name: 'Open Career' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Open Blogger' })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Rename Blogger' }).click();
    await sidebar.getByLabel('Rename Blogger').fill('Writer');
    await sidebar.getByRole('button', { name: 'Save Blogger name' }).click();
    await expect(sidebar.getByRole('button', { name: 'Open Writer' })).toBeVisible();
    await page.setViewportSize({ width: 780, height: 760 });
    await expect(page.getByRole('button', { name: 'Show navigation' })).toBeVisible();
    await expect(page.locator('.shell')).toHaveClass(/sidebar-collapsed/);
    await page.getByRole('button', { name: 'Show navigation' }).click();
    await expect(page.locator('.shell')).not.toHaveClass(/sidebar-collapsed/);
    await page.setViewportSize({ width: 1280, height: 800 });
    await sidebar.getByRole('button', { name: 'Open Writer' }).click();
    await expect(page.getByRole('heading', { name: /What should our first article be about/ })).toBeVisible();
    const writerComposer = page.getByLabel('Message Writer');
    await page.getByLabel('Interface language').selectOption('tr');
    await page.getByRole('button', { name: 'Yayınlanmış yazılarım' }).click();
    await expect(page.getByLabel('Writer uzmanına mesaj yaz')).toHaveValue('Yayınlanmış yazılarım');
    await page.getByLabel('Arayüz dili').selectOption('en');
    await expect(writerComposer).toHaveValue('Yayınlanmış yazılarım');
    await writerComposer.focus();
    await expect(writerComposer).toHaveCSS('outline-style', 'none');
    const autopilotMode = page.locator('.composer-mode');
    await expect(autopilotMode).toContainText('Autopilot');
    await autopilotMode.click();
    await expect(page.locator('.mode-popover').getByRole('button', { name: /Autopilot/ })).toHaveAttribute('aria-pressed', 'true');
    await writerComposer.fill('Yerel ve frontier modeller arasında pratik yönlendirme üzerine yazalım.');
    await writerComposer.press('Enter');
    await expect(page.getByRole('heading', { name: /Where can I learn your writing style/ })).toBeVisible();
    await writerComposer.fill('Yayınladığım yazılarım burada: https://asozyurt.com/writing/');
    await writerComposer.press('Enter');
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, remember this' }).click();
    await expect(page.getByText(/non-empty source list/i)).toHaveCount(0);
    await sidebar.getByRole('button', { name: 'Open Career' }).click();
    await expect(page.getByRole('heading', { name: /What should I use as sources for your CV/ })).toBeVisible();

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

    await sidebar.getByRole('button', { name: 'Open Writer' }).click();
    await page.locator('nav').getByRole('button', { name: /Publishing/ }).click();
    await page.getByLabel('Website domain').fill('example.com');
    await page.getByLabel('Site workspace').selectOption('project');
    await page.getByLabel('Article folder').fill('src/content/writing');
    await page.getByLabel('Production branch').fill('release');
    await page.getByLabel('Approved asset folders').fill('public/images/writing');
    await page.getByLabel('Public article base URL').fill('https://example.com/writing');
    await page.getByRole('button', { name: 'Save website target' }).click();
    await expect(page.getByText('Website publishing target saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Use approved Blogger files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use approved Blogger files' })).toBeVisible();
    await expect(page.getByText(/do not need to copy repository paths or hashes/i)).toBeVisible();
    await expect(page.getByText('Advanced: choose repository files manually')).toBeVisible();
    await expect(page.getByLabel('Translation paths')).not.toBeVisible();
    await expect(page.getByTestId('linkedin-connection-state')).toHaveText('Disconnected');
    await page.getByLabel('LinkedIn app client ID').fill('e2e-public-client');
    await page.getByLabel('LinkedIn API version').fill('202608');
    await page.getByRole('button', { name: 'Save setup' }).click();
    await expect(page.getByText(/does not connect an account/)).toBeVisible();
    await expect(page.getByTestId('linkedin-connection-state')).toHaveText('Disconnected');
    await page.getByRole('button', { name: 'Connect LinkedIn' }).click();
    await expect(page.getByTestId('linkedin-connection-state')).toHaveText('Connected');
    await expect(page.getByText(/Mock LinkedIn Member/)).toBeVisible();
    await sidebar.getByRole('button', { name: 'Open Career' }).click();

    await page.locator('.settings-link').click();
    await expect(page.getByLabel('Intelligence availability')).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Allow local models' })).toHaveAttribute('aria-pressed', /true|false/);
    await expect(page.getByRole('button', { name: 'Save intelligence access' })).toBeDisabled();
    const providerAccess = page.getByRole('button', { name: 'Allow connected cloud providers' });
    await expect(providerAccess).toHaveAttribute('aria-pressed', 'false');
    await providerAccess.click();
    await expect(providerAccess).toHaveAttribute('aria-pressed', 'true');
    await page.getByText('Detected provider connections').click();
    await expect(page.getByText('Cognition Devin', { exact: true })).toBeVisible();
    const primaryProvider = page.locator('.provider-policy-row.allowed').first();
    await expect(primaryProvider).toBeVisible();
    await expect(primaryProvider.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(primaryProvider.getByText('Priority 1')).toBeVisible();
    await page.getByRole('button', { name: 'View model status' }).click();
    await expect(page.getByRole('heading', { name: 'Models Career can reach' })).toBeVisible();
    await page.locator('.settings-link').click();
    await page.getByText('Offline demo for testing').click();
    const configureDemo = page.getByRole('button', { name: 'Configure simulated demo' });
    await expect(configureDemo).toHaveClass(/secondary/);
    await configureDemo.click();
    await page.getByRole('button', { name: 'Save intelligence access' }).click();
    await expect(page.getByText('Simulated demo configured but inactive.')).toBeVisible();
    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await page.getByLabel('Message Career').fill('This must not reach the simulated model yet.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('heading', { name: 'Choose what Career may use' })).toBeVisible();
    await expect(page.getByText('Choose allowed intelligence sources, or explicitly enable the demo in Intelligence access.')).toBeVisible();
    await page.getByText('Offline demo for testing').click();
    await page.getByRole('button', { name: 'Enable simulated demo for this session' }).click();
    await expect(page.getByText('Simulated demo enabled for this session. No AI model will be used.')).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    const composer = page.getByLabel('Message Career');
    const contextUsage = page.getByTestId('context-usage');
    await expect(contextUsage).toHaveAccessibleName(/\d+% context used, .* of 48 KB/);
    await contextUsage.hover();
    const contextTooltip = contextUsage.getByRole('tooltip');
    await expect(contextTooltip).toBeVisible();
    await expect(contextTooltip).toContainText(/\d+% context used/);
    await expect(contextTooltip).toContainText('prompt budget');
    await expect(page.locator('.composer-mode')).toContainText('Autopilot');
    await page.locator('.composer-mode').click();
    await page.locator('.mode-popover').getByRole('button', { name: /Standard/ }).click();
    await expect(page.locator('.composer-mode')).toContainText('Standard');
    await composer.fill('https://github.com/asozyurt');
    await composer.press('Enter');
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, remember this' }).click();
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Would you like to add another source or detail/ })).toBeVisible();
    await composer.fill('my linkedin account -> http://linkedin.com/in/asozyurt');
    await composer.press('Enter');
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, remember this' }).click();
    await expect(page.getByRole('heading', { name: /Would you like to add another source or detail/ })).toHaveCount(0);
    await composer.fill('Keep this cancelled draft');
    await composer.press('Enter');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Message cancelled. Your draft is ready to edit or send again.')).toBeVisible();
    await expect(composer).toHaveValue('Keep this cancelled draft');
    await expect(page.getByText('Mock response: Keep this cancelled draft', { exact: true })).toHaveCount(0);
    await composer.fill('First line');
    await composer.press('Shift+Enter');
    await composer.type('Second line');
    await expect(composer).toHaveValue('First line\nSecond line');
    await composer.fill('What changed that should appear in my profile?');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await composer.press('Enter');
    await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();
    await expect(page.getByLabel('Career is thinking')).toBeVisible();
    await expect(page.getByText(/Mock response:/).first()).toBeVisible();
    await expect(contextUsage).toHaveAccessibleName(/\d+% context used, .* of 48 KB/);
    await expect(page.getByLabel('Model used: Simulated demo').first()).toBeVisible();
    await expect(page.locator('.user-turn').first().getByLabel('Standard mode')).toBeVisible();
    await page.getByRole('button', { name: 'Show context' }).click();
    const inspector = page.getByLabel('Active session inspector');
    await expect(inspector).toBeVisible();
    await inspector.getByRole('tab', { name: 'Privacy' }).click();
    await expect(inspector.getByText('Auto', { exact: true })).toBeVisible();
    await expect(inspector.getByText('Simulated demo', { exact: true })).toBeVisible();
    await expect(inspector.getByText(/^(Cloud permitted|Local Only)$/)).toBeVisible();
    await inspector.getByRole('tab', { name: 'Files' }).click();
    await expect(inspector.getByRole('button', { name: 'README.md' })).toBeVisible();
    await inspector.getByRole('button', { name: 'README.md' }).click();
    await expect(inspector.getByText('# profile-repo')).toBeVisible();
    await page.locator('.composer-mode').click();
    await page.locator('.mode-popover').getByRole('button', { name: /Autopilot/ }).click();
    await expect(page.locator('.composer-mode')).toContainText('Autopilot');
    const conversationSidebar = page.getByLabel('Career conversation history');
    await expect(conversationSidebar).toBeVisible();
    await conversationSidebar.getByRole('button', { name: 'New Career conversation' }).click();
    await expect(conversationSidebar.locator('.session-open[aria-current="true"]')).toContainText('Career conversation');
    await page.getByLabel('Message Career').fill('Prepare another career conversation');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('Mock response: Prepare another career conversation', { exact: true })).toBeVisible();
    await expect(page.locator('.composer-mode')).toContainText('Autopilot');
    const newSessionOptions = conversationSidebar.locator('li.active').getByRole('button', { name: 'Chat options for Career conversation' });
    await newSessionOptions.click();
    await conversationSidebar.getByRole('menuitem', { name: 'Rename' }).click();
    const renameInput = conversationSidebar.getByLabel('Rename Career conversation');
    await renameInput.fill('Second conversation');
    await renameInput.press('Enter');
    await expect(conversationSidebar.locator('.session-open', { hasText: 'Second conversation' })).toHaveAttribute('aria-current', 'true');
    await conversationSidebar.locator('.session-open:not([aria-current])', { hasText: 'Career conversation' }).click();
    await expect(page.locator('.composer-mode')).toContainText('Autopilot');
    await expect(page.getByText('What changed that should appear in my profile?', { exact: true })).toBeVisible();
    const secondSessionOptions = conversationSidebar.getByRole('button', { name: 'Chat options for Second conversation' });
    await secondSessionOptions.click();
    await conversationSidebar.getByRole('menuitem', { name: 'Delete' }).click();
    const deleteDialog = conversationSidebar.getByRole('group', { name: 'Delete Second conversation?' });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();
    await expect(conversationSidebar.locator('.session-open', { hasText: 'Second conversation' })).toHaveCount(0);
    const longPrompt = `Scroll marker ${'career evidence '.repeat(180)}`;
    await page.getByLabel('Message Career').fill(longPrompt);
    await sendButton.click();
    await expect(page.getByText(`Mock response: ${longPrompt}`, { exact: true })).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Career audit/ }).click();
    await page.getByRole('button', { name: 'Run career audit' }).click();
    await expect(page.getByText('Career audit completed.')).toBeVisible();
    await expect(page.getByText(/Mock response:/).last()).toBeVisible();
    await inspector.getByRole('tab', { name: /Evidence/ }).click();
    await expect(inspector.getByRole('button', { name: 'Open file' }).first()).toBeVisible();
    await inspector.getByRole('button', { name: 'Open file' }).first().click();
    await expect(inspector.getByText('# profile-repo')).toBeVisible();

    await page.locator('nav').getByRole('button', { name: /Review changes/ }).click();
    await page.getByLabel('Profile workspace').selectOption('profile');
    await page.getByLabel('Requested improvement').fill('Updated summary from e2e proposal');
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
    await expect(page.locator('main pre')).toContainText('Updated summary from e2e proposal');
    await inspector.getByRole('tab', { name: /Actions/ }).click();
    await expect(inspector.getByText('PROPOSED', { exact: true })).toBeVisible();
    await expect(inspector.locator('pre')).toContainText('Updated summary from e2e proposal');
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const page = await secondRun.firstWindow();
    const sidebar = page.getByRole('complementary', { name: 'Specialist workspace navigation' });
    await expect(sidebar.getByRole('button', { name: 'Open Writer' })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Rename Writer' }).click();
    await sidebar.getByLabel('Rename Writer').fill('Blogger');
    await sidebar.getByRole('button', { name: 'Save Writer name' }).click();
    await expect(sidebar.getByRole('button', { name: 'Open Blogger' })).toBeVisible();
    await expect(page.getByText('Simulated demo is configured but inactive')).toBeVisible();
    await page.locator('nav').getByRole('button', { name: /Workspaces/ }).click();
    await expect(page.getByRole('heading', { name: 'profile', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'project', exact: true })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Open Blogger' }).click();
    await page.locator('nav').getByRole('button', { name: /Publishing/ }).click();
    await expect(page.getByLabel('Website domain')).toHaveValue('example.com');
    await expect(page.getByLabel('Site workspace')).toHaveValue('project');
    await expect(page.getByLabel('Public article base URL')).toHaveValue('https://example.com/writing');
    await expect(page.getByLabel('LinkedIn app client ID')).toHaveValue('e2e-public-client');
    await expect(page.getByLabel('LinkedIn API version')).toHaveValue('202608');
    await sidebar.getByRole('button', { name: 'Open Career' }).click();

    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await expect(page.getByText('What changed that should appear in my profile?', { exact: true })).toBeVisible();
    await expect.poll(async () => page.locator('.conversation').evaluate((element) =>
      element.scrollHeight - element.scrollTop - element.clientHeight,
    )).toBeLessThan(3);

    await page.locator('nav').getByRole('button', { name: /Review changes/ }).click();
    await expect(page.getByText('PROPOSED', { exact: true })).toBeVisible();
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
    await page.locator('.settings-link').click();
    await page.getByText('Offline demo for testing').click();
    await page.getByRole('button', { name: 'Configure simulated demo' }).click();
    await page.getByRole('button', { name: 'Save intelligence access' }).click();
    await page.getByRole('button', { name: 'Enable simulated demo for this session' }).click();
    await page.locator('nav').getByRole('button', { name: /Career chat/ }).click();
    await page.getByLabel('Message Career').fill('https://github.com/asozyurt');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toBeVisible();
    await page.getByRole('button', { name: 'Yes, remember this' }).click();
    await expect(page.getByRole('heading', { name: 'Did I understand this correctly?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Would you like to add another source or detail/ })).toBeVisible();
    await page.getByLabel('Message Career').fill('no');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('heading', { name: /Would you like to add another source or detail/ })).toHaveCount(0);
    await page.getByLabel('Message Career').fill('Review my profile.');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await sendButton.click();

    const transcriptError = page.getByRole('alert').filter({ hasText: 'Usage limit reached' });
    await expect(transcriptError).toBeVisible();
    await expect(transcriptError).toContainText('HTTP 429: you (asozyurt) have reached your session usage limit');
    await expect(page.getByText('Review my profile.', { exact: true })).toBeVisible();
    await expect(sendButton).toBeDisabled();
    await page.getByLabel('Message Career').fill('Review my profile again.');
    await expect(sendButton).toBeEnabled();
    await expect(page.locator('.toast.error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('interface language persists without changing conversation data', async () => {
  const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-language-appdata-'));
  const launch = async () => electron.launch({
    args: ['.'],
    cwd: path.resolve('.'),
    env: { ...process.env, AW_RENDERER_MODE: 'file', AW_USER_DATA_PATH: appDataRoot },
  });

  const firstRun = await launch();
  try {
    const page = await firstRun.firstWindow();
    const selector = page.getByLabel('Interface language');
    await expect(selector).toHaveValue('en');
    await selector.selectOption('tr');
    await expect(page.getByRole('complementary', { name: 'Uzman çalışma alanı navigasyonu' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /CV ve kariyer profilin/ })).toBeVisible();
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const page = await secondRun.firstWindow();
    await expect(page.getByLabel('Arayüz dili')).toHaveValue('tr');
    await expect(page.getByRole('complementary', { name: 'Uzman çalışma alanı navigasyonu' })).toBeVisible();
  } finally {
    await secondRun.close();
  }
});

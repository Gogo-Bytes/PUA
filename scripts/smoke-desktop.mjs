import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'pi-desktop-smoke-'));
const profile = path.join(temp, 'profile');
const project = path.join(temp, '项目 with spaces');
await mkdir(profile); await mkdir(project);
const hooks = path.join(temp, 'empty-hooks');
await mkdir(hooks);
const git = (...args) => exec('git', ['-c', `core.hooksPath=${hooks}`,  '-c', 'commit.gpgsign=false', '-c', 'user.name=Desktop Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: project });
await git('init', '--initial-branch=main');
await writeFile(path.join(project, 'editor.ts'), 'export const mode = "base";\n');
await git('add', 'editor.ts'); await git('commit', '-m', 'fixture');
await writeFile(path.join(project, 'editor.ts'), 'export const mode = "staged";\n'); await git('add', 'editor.ts');
await writeFile(path.join(project, 'editor.ts'), 'export const mode = "working";\n');
await writeFile(path.join(project, 'notes.md'), '# Review notes\n');
await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({
  piPath: path.join(root, 'tests/fixtures/mock-pi.mjs'), nodePath: process.execPath,
  args: ['--test-argument', 'spaces;$(not-a-shell)'], fontSize: 14, recentProjects: [],
}));
const executablePath = process.env.PI_DESKTOP_TEST_EXECUTABLE;
const app = await electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], cwd: root, timeout: 20000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
const window = await app.firstWindow({ timeout: 15000 });
window.setDefaultTimeout(15000);
const errors = [];
window.on('pageerror', error => errors.push(String(error)));
try {
  await window.getByRole('heading', { name: '熟悉的 Pi。 更顺手的工作空间。' }).waitFor();
  assert.equal(await window.evaluate(() => typeof globalThis.require), 'undefined');
  await window.evaluate(() => { window.__events = []; window.desktop.onTerminalEvent(event => window.__events.push(event)); });
  await mkdir(path.join(root, '.agent-work/desktop/evidence'), { recursive: true });
  await window.screenshot({ path: path.join(root, '.agent-work/desktop/evidence/welcome.png') });
  await window.getByRole('button', { name: '打开一个项目' }).click();
  await window.getByRole('textbox', { name: '项目文件夹', exact: true }).fill(project);
  await window.getByRole('button', { name: '打开工作空间' }).click();
  await window.waitForFunction(() => window.__events.some(event => event.type === 'data' && event.data.includes('MOCK_PI_READY')));
  const firstId = await window.locator('.terminal-pane.active').getAttribute('data-session-id');
  const initial = await window.evaluate(() => window.__events.filter(event => event.type === 'data').map(event => event.data).join(''));
  assert(initial.includes(project));
  assert(initial.includes('spaces;$(not-a-shell)'));

  await window.getByRole('button', { name: '重命名', exact: true }).click();
  await window.getByRole('textbox', { name: '会话显示名', exact: true }).fill('修复编辑器');
  await window.getByRole('button', { name: '保存显示名' }).click();
  await window.getByRole('textbox', { name: '筛选会话' }).fill('修复');
  assert.equal(await window.locator('.session-select').count(), 1);
  await window.getByRole('textbox', { name: '筛选会话' }).fill('not-present');
  assert.equal(await window.locator('.session-select').count(), 0);
  await window.getByRole('textbox', { name: '筛选会话' }).fill('');

  await window.getByRole('button', { name: '变更审查', exact: true }).click();
  await window.locator('.changed-files button').filter({ hasText: 'editor.ts' }).click();
  await window.waitForFunction(() => document.querySelector('.diff-content')?.textContent.includes('+export const mode = "working"'));
  await window.getByRole('tab', { name: '已暂存' }).click();
  await window.locator('.changed-files button').filter({ hasText: 'editor.ts' }).click();
  await window.waitForFunction(() => document.querySelector('.diff-content')?.textContent.includes('+export const mode = "staged"'));
  await window.getByRole('button', { name: '引用给 Pi' }).click();
  assert((await window.getByRole('textbox', { name: '多行草稿' }).inputValue()).includes('editor.ts'));
  await window.screenshot({ path: path.join(root, '.agent-work/desktop/evidence/review.png') });
  // Real refresh failure must remove stale reference actions, not leave status!.root reachable.
  await rename(path.join(project, '.git'), path.join(temp, 'saved-git'));
  await window.getByRole('button', { name: '刷新', exact: true }).click();
  await window.getByRole('heading', { name: '暂时无法读取 Git' }).waitFor();
  assert.equal(await window.getByRole('button', { name: '引用给 Pi' }).count(), 0);
  await rename(path.join(temp, 'saved-git'), path.join(project, '.git'));
  await window.getByRole('button', { name: '刷新', exact: true }).click();
  await window.locator('.changed-files button').first().waitFor();
  await window.getByRole('button', { name: '关闭变更面板' }).click();
  await window.getByRole('textbox', { name: '多行草稿' }).fill('你好 Pi\nsecond line');
  await window.getByRole('button', { name: '粘贴到 Pi' }).click();
  await window.evaluate(id => window.desktop.write(id, '\x02'), firstId);
  await window.waitForFunction(() => window.__events.some(event => event.type === 'data' && event.data.includes('INPUT_BASE64=')));
  let input = await window.evaluate(() => window.__events.filter(event => event.type === 'data').map(event => event.data).join(''));
  let decoded = Buffer.from(input.match(/INPUT_BASE64=([^\r\n]+)/)[1], 'base64').toString();
  assert.equal(decoded, '\x1b[200~你好 Pi\rsecond line\x1b[201~');

  await window.evaluate(() => { window.__events = []; });
  await window.locator('.terminal-pane.active .xterm-helper-textarea').press('Shift+Enter');
  await window.evaluate(id => window.desktop.write(id, '\x02'), firstId);
  await window.waitForFunction(() => window.__events.some(event => event.type === 'data' && event.data.includes('INPUT_BASE64=')));
  input = await window.evaluate(() => window.__events.filter(event => event.type === 'data').map(event => event.data).join(''));
  decoded = Buffer.from(input.match(/INPUT_BASE64=([^\r\n]+)/)[1], 'base64').toString();
  assert.equal(decoded, '\x1b[13;2u');

  await window.getByRole('button', { name: '命令面板' }).click();
  await window.getByRole('textbox', { name: '搜索命令' }).fill('模型');
  await window.getByRole('button', { name: '选择模型' }).click();
  await window.evaluate(() => { window.__events = []; });
  await window.evaluate(id => window.desktop.write(id, '\x02'), firstId);
  await window.waitForFunction(() => window.__events.some(event => event.type === 'data' && event.data.includes('INPUT_BASE64=')));
  input = await window.evaluate(() => window.__events.filter(event => event.type === 'data').map(event => event.data).join(''));
  decoded = Buffer.from(input.match(/INPUT_BASE64=([^\r\n]+)/)[1], 'base64').toString();
  assert.equal(decoded, '\x1b[200~/model\x1b[201~');

  await window.getByRole('button', { name: '打开项目', exact: false }).first().click();
  await window.getByRole('radio', { name: '继续最近会话' }).check();
  await window.getByRole('button', { name: '打开工作空间' }).click();
  await window.waitForFunction(first => window.__events.some(event => event.type === 'data' && event.id !== first && event.data.includes('--continue')), firstId);
  const secondId = await window.locator('.terminal-pane.active').getAttribute('data-session-id');
  assert.notEqual(firstId, secondId);
  assert.equal(await window.locator('.terminal-pane').count(), 2);
  assert.equal(await window.getByRole('textbox', { name: '多行草稿' }).inputValue(), '');
  await window.getByRole('textbox', { name: '多行草稿' }).fill('第二个会话的草稿');
  // A hidden tab still parses/acknowledges output; switching must not kill or stall it.
  await window.evaluate(id => window.desktop.write(id, '\x07'), firstId);
  await window.waitForFunction(id => window.__events.some(event => event.id === id && event.type === 'data' && event.data.includes('FLOW_COMPLETE')), firstId, { timeout: 30000 });
  await window.locator('.session-select').first().click();
  assert.equal(await window.getByRole('textbox', { name: '多行草稿' }).inputValue(), '你好 Pi\nsecond line');
  await window.getByRole('button', { name: '搜索', exact: true }).click();
  await window.getByRole('textbox', { name: '搜索终端历史' }).fill('FLOW_COMPLETE');
  await window.getByRole('textbox', { name: '搜索终端历史' }).press('Enter');
  assert.equal(await window.getByText('未找到', { exact: true }).count(), 0);
  await window.screenshot({ path: path.join(root, '.agent-work/desktop/evidence/terminal.png') });

  const denied = await window.evaluate(async () => {
    try { await window.desktop.openExternal('file:///etc/passwd'); return false; } catch { return true; }
  });
  assert(denied, 'renderer should not open arbitrary file URL handlers');
  for (const id of [firstId, secondId]) await window.evaluate(id => window.desktop.write(id, '\x04'), id);
  await window.waitForFunction(() => window.__events.filter(event => event.type === 'exit').length === 2);
  await window.locator('.close-session').first().click();
  await window.waitForFunction(() => document.querySelectorAll('.terminal-pane').length === 1);
  assert.deepEqual(errors, []);
  console.log('PASS: Electron startup, sandbox, real PTY, cwd/argv, bracketed Unicode paste, modified Enter, command insertion, two sessions, hidden-tab flow control, search, external URL boundary, session rename/filter, separate drafts, real Git staged/unstaged diff, feedback reference and exit cleanup.');
} finally {
  // All fixtures can be terminated without user-data risk; never run this against a real Pi session.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}

// Production Electron environment smoke with temporary userData and a local mock Pi.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { invokeChannels } from '../dist/shared/ipc/channels.js';
const root = process.cwd();
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pua-environment-')));
const profile = path.join(temp, 'profile');
const project = path.join(temp, 'layout-project');
const output = process.env.PUA_ENVIRONMENT_EVIDENCE || path.join(root, '.agent-work/workbench-followup/stage2');
await mkdir(profile);
await mkdir(project);
await mkdir(output, { recursive: true });
await writeFile(
  path.join(profile, 'desktop-settings.json'),
  JSON.stringify({
    piPath: path.join(root, 'tests/fixtures/mock-pi.mjs'),
    nodePath: process.execPath,
    args: [],
    fontSize: 14,
    recentProjects: [project],
  }),
);
// Test-only composition seam: bootstrap consumes os.homedir for native Pi
// discovery, so userData alone is insufficient to isolate the host filesystem.
const entry = path.join(temp, 'launch.cjs');
await writeFile(
  entry,
  `require('node:os').homedir = () => ${JSON.stringify(temp)};
require('electron').app.setPath('home', ${JSON.stringify(temp)});
const ipcMain = require('electron').ipcMain;
const handle = ipcMain.handle.bind(ipcMain);
const channels = ${JSON.stringify([invokeChannels.gitStatus, invokeChannels.gitBranches, invokeChannels.gitWorktrees])};
globalThis.__environmentHold = false;
globalThis.__environmentPending = [];
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  const result = await listener(event, ...args);
  if (!globalThis.__environmentHold || !channels.includes(channel)) return result;
  return new Promise(resolve => globalThis.__environmentPending.push({ channel, id: args[0], release: () => resolve(result) }));
});
void import(${JSON.stringify(pathToFileURL(path.join(root, 'dist/app/main/bootstrap.js')).href)});
`,
);
let app;
try {
  app = await electron.launch({
    args: [entry, `--user-data-dir=${profile}`],
    cwd: root,
    timeout: 20000,
    env: { ...process.env, PUA_MOCK_STARTUP_DIALOG: '0' },
  });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const resize = async width => {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await page.waitForFunction(width => window.innerWidth === width, width);
    await page.waitForTimeout(100);
  };
  await resize(1600);
  const launch = page.getByRole('button', { name: /^在 layout-project 中新建对话/ });
  await launch.press('Enter');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('first isolated session');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).press('Enter');
  await page.getByRole('heading', { name: '原生回复', exact: true }).waitFor();
  const a = await page.locator('.chat-pane.active').getAttribute('data-session-id');
  await launch.press('Enter');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('second isolated session');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).press('Enter');
  await page.waitForFunction(a => {
    const pane = document.querySelector('.chat-pane.active');
    return pane && pane.getAttribute('data-session-id') !== a && pane.textContent.includes('原生回复');
  }, a);
  const b = await page.locator('.chat-pane.active').getAttribute('data-session-id');
  await app.evaluate(() => {
    globalThis.__environmentHold = true;
  });
  const toggle = page.locator('[aria-controls="workspace-environment"]');
  await toggle.click();
  const waitPending = async count => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await app.evaluate((_electron, expected) => globalThis.__environmentPending.length === expected, count)) return;
      await page.waitForTimeout(50);
    }
    throw new Error(`Expected ${count} deferred IPC reads`);
  };
  await waitPending(3);
  assert.deepEqual(await app.evaluate(() => globalThis.__environmentPending.map(call => call.id)), [b, b, b]);
  await toggle.click();
  await app.evaluate(() => globalThis.__environmentPending.slice(0, 3).forEach(call => call.release()));
  await toggle.click();
  await waitPending(6);
  // New sessions sort by activity, so select the older first session by its row.
  await page.locator('.codex-session-row .ui-rename-display').nth(1).click();
  assert.equal(await page.locator('.chat-pane.active').getAttribute('data-session-id'), a);
  await waitPending(9);
  await app.evaluate(() => globalThis.__environmentPending.slice(3, 6).forEach(call => call.release()));
  assert.equal(
    await page
      .locator('.environment-panel')
      .getByText(/无法读取本地分支/)
      .count(),
    0,
  );
  await app.evaluate(() => globalThis.__environmentPending.slice(6, 9).forEach(call => call.release()));
  await page
    .locator('.environment-panel')
    .getByText(/无法读取本地分支/)
    .waitFor();
  await page.screenshot({ path: path.join(output, 'desktop-environment-read.png') });
  await toggle.click();
  await toggle.click();
  await waitPending(12);
  // Remove the originating session through its real host close/archive workflow.
  // Terminal/session owner and close authorization are unchanged.
  await page.locator('.codex-session-row[data-active] button[aria-label^="关闭 "]').click();
  await page.waitForFunction(a => !document.querySelector(`.chat-pane[data-session-id="${a}"]`), a);
  await app.evaluate(() => globalThis.__environmentPending.slice(9, 12).forEach(call => call.release()));
  assert.equal(await page.locator('.chat-pane.active').getAttribute('data-session-id'), b);
  assert.equal(
    await page
      .locator('.environment-panel')
      .getByText(/无法读取本地分支/)
      .count(),
    0,
  );
  await page.screenshot({ path: path.join(output, 'desktop-environment-closed-target.png') });
  assert.deepEqual(errors, []);
  console.log(
    'PASS isolated Electron environment reads: visible target, close/reopen, session switch, closed-target late results; real preload/IPC against temporary non-repository only.',
  );
} catch (error) {
  if (app)
    console.error(
      'Deferred main reads:',
      await app.evaluate(() => ({
        hold: globalThis.__environmentHold,
        pending: globalThis.__environmentPending.map(({ channel, id }) => ({ channel, id })),
      })),
    );
  if (app)
    console.error(
      'Environment smoke snapshot:',
      await (
        await app.firstWindow()
      ).evaluate(() => ({
        active: document.querySelector('.chat-pane.active')?.getAttribute('data-session-id'),
        panes: [...document.querySelectorAll('.chat-pane')].map(node => ({
          id: node.getAttribute('data-session-id'),
          active: node.classList.contains('active'),
          text: node.textContent.slice(-600),
        })),
        alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent),
      })),
    );
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ dialog }) => {
        globalThis.__environmentPending.forEach(call => call.release());
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(temp, { recursive: true, force: true });
}

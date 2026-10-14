// Production Electron layout smoke with temporary userData and a local mock Pi.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
const root = process.cwd();
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pua-layout-')));
const profile = path.join(temp, 'profile');
const project = path.join(temp, 'layout-project');
const output = process.env.PUA_LAYOUT_EVIDENCE || path.join(root, '.agent-work/workbench-stage1');
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
void import(${JSON.stringify(pathToFileURL(path.join(root, 'dist/app/main/bootstrap.js')).href)});
`,
);
const server = createServer((_request, response) => response.end('<title>Isolated layout smoke</title><p>Local BrowserView fixture</p>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
  const column = page.locator('#workspace-environment');
  const toggle = page.locator('[aria-controls="workspace-environment"]');
  const visible = async value => {
    await page.waitForFunction(
      value => document.querySelector('#workspace-environment')?.getAttribute('aria-hidden') === String(!value),
      value,
    );
    assert.equal(await toggle.getAttribute('aria-expanded'), String(value));
  };
  await resize(1600);
  await page.getByRole('button', { name: /^在 layout-project 中新建对话/ }).press('Enter');
  const pending = page.getByRole('textbox', { name: '发送消息', exact: true });
  await pending.fill('隔离桌面布局 smoke');
  await pending.press('Enter');
  await page.locator('.chat-pane.active').waitFor();
  await page.getByRole('heading', { name: '原生回复', exact: true }).waitFor();
  const sessionId = await page.locator('.chat-pane.active').getAttribute('data-session-id');
  const input = page.locator('.chat-pane.active').getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('resize 后保留的草稿');
  await resize(1600);
  await toggle.click();
  await visible(true);
  await page.locator('.environment-panel').focus();
  await resize(1300);
  await visible(false);
  assert(await toggle.evaluate(node => node === document.activeElement));
  await resize(900);
  await visible(false);
  await resize(1600);
  await visible(true);
  assert.equal(await input.inputValue(), 'resize 后保留的草稿');
  assert.equal(await page.locator('.chat-pane.active').getAttribute('data-session-id'), sessionId);
  assert.equal(await page.locator('.chat-pane').count(), 1);
  await page.screenshot({ path: path.join(output, 'desktop-wide.png') });

  // Native BrowserView follows the same drawer geometry and lifetime.
  await page.getByRole('button', { name: '浏览器', exact: true }).click();
  await page.getByRole('textbox', { name: '浏览器地址' }).waitFor();
  const views = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].contentView.children.map(view => ({ bounds: view.getBounds(), visible: view.getVisible() })),
    );
  await page.waitForFunction(() => document.querySelector('.workspace-browser-go')?.disabled === false);
  const address = page.getByRole('textbox', { name: '浏览器地址' });
  await address.fill(`http://127.0.0.1:${server.address().port}`);
  await address.press('Enter');
  await page.waitForTimeout(200);
  let native = await views();
  assert.equal(native.length, 1);
  assert(native[0].bounds.width > 0 && native[0].visible);
  await page.getByRole('separator', { name: '调整右侧面板宽度' }).press('Home');
  await page.waitForTimeout(150);
  native = await views();
  const surface = await page.locator('.workspace-browser-surface').boundingBox();
  assert(Math.abs(native[0].bounds.width - surface.width) <= 1);
  await page.getByRole('separator', { name: '调整右侧面板宽度' }).press('End');
  await visible(false);
  await resize(900);
  await page.waitForTimeout(150);
  native = await views();
  const chrome = page.getByRole('banner', { name: '窗口操作栏' });
  await chrome.getByRole('button', { name: '收起右侧面板', exact: true }).click();
  await page.waitForTimeout(350);
  native = await views();
  assert.equal(native[0].bounds.width, 0);
  await resize(1600);
  await chrome.getByRole('button', { name: '显示右侧面板', exact: true }).click();
  await page.waitForTimeout(350);
  native = await views();
  assert.equal(native.length, 1);
  assert(native[0].bounds.width > 0);
  await page.getByRole('button', { name: '关闭 浏览器 标签页', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal((await views()).length, 0);
  await toggle.click(); // Revoke open intent while automatically collapsed.
  await page.getByRole('separator', { name: '调整右侧面板宽度' }).press('Home');
  await resize(1700);
  await visible(false);
  assert.equal(await input.inputValue(), 'resize 后保留的草稿');
  assert.deepEqual(errors, []);
  assert.equal(await column.evaluate(node => node.inert), true);
  console.log(
    'PASS: isolated production Electron, mock chat/draft identity, layout/focus/restore/manual close, native BrowserView bounds/hide/reuse/dispose. No real user Pi or repository used.',
  );
} finally {
  if (app) {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

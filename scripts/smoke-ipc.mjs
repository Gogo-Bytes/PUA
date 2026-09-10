import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { invokeChannels, sendChannels, eventChannels } from '../dist/shared/ipc/channels.js';

const root = process.cwd();
const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pua-ipc-')));
const fixture = path.join(root, 'tests/fixtures/mock-pi.mjs');
let app;
let watchdog;
try {
  // Explicit fixture resolution only; this smoke never creates or starts a Pi session.
  await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({
    piPath: fixture, nodePath: process.execPath, args: [], fontSize: 14, recentProjects: [],
  }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, timeout: 20000 });
  watchdog = setTimeout(() => {
    console.error('IPC smoke exceeded 45 seconds; killing only its launched Electron');
    process.exitCode = 1;
    app.process().kill('SIGKILL');
  }, 45000);
  console.log('IPC smoke: launched isolated Electron', app.process().pid);
  app.process().stderr.on('data', data => process.stderr.write(data));
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => typeof window.desktop?.bootstrap === 'function');
  console.log('IPC smoke: preload ready');
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), ['undefined', 'undefined']);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.desktop).sort()),
    [...Object.keys(invokeChannels), ...Object.keys(sendChannels), ...Object.keys(eventChannels)].sort());
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap());
  assert.equal(bootstrap.runtime.source, fixture);
  assert.equal(bootstrap.preferences.piPath, fixture);
  assert.deepEqual(bootstrap.preferences.recentProjects, []);
  // A second sandboxed window at the exact same URL still has no desktop authority.
  const foreignWindow = app.waitForEvent('window', { timeout: 15000 });
  const foreignId = await app.evaluate(({ BrowserWindow }, preload) => {
    const trusted = BrowserWindow.getAllWindows()[0];
    const foreign = new BrowserWindow({ show: false, webPreferences: {
      preload,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    void foreign.loadURL(trusted.webContents.getURL());
    return foreign.id;
  }, path.join(root, 'dist/main/preload.cjs'));
  try {
    const foreignPage = await foreignWindow;
    foreignPage.setDefaultTimeout(15000);
    await foreignPage.waitForFunction(() => typeof window.desktop?.bootstrap === 'function');
    const rejection = await foreignPage.evaluate(async () => {
      try { await window.desktop.bootstrap(); return 'ACCEPTED'; } catch (error) { return String(error); }
    });
    assert(rejection.includes('Untrusted IPC sender'), rejection);
  } finally {
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), foreignId);
  }
  const rejections = await page.evaluate(async () => {
    const calls = [
      () => window.desktop.openExternal('file:///tmp/never-open'),
      () => window.desktop.createSession({ cwd: '.', kind: 'invalid', startMode: 'new', projectTrust: 'default' }),
      () => window.desktop.sendChatMessage('not-a-session', { attachmentIds: [], delivery: 'invalid' }),
      () => window.desktop.respondToExtensionUI('not-a-session', { id: 'x', value: 'x', confirmed: true }),
      () => window.desktop.fileDiff('not-a-session', 'never-read', 'invalid'),
      () => window.desktop.savePreferences({}),
      () => window.desktop.writeClipboard(42),
    ];
    return Promise.all(calls.map(async call => { try { await call(); return 'ACCEPTED'; } catch (error) { return String(error); } }));
  });
  for (const [index, fragment] of ['HTTP(S)', '无效会话类型', '无效发送方式', '唯一结果', '未知 diff 范围', '设置格式错误', '无效字符串'].entries()) {
    assert(rejections[index].includes(fragment), rejections[index]);
  }
  await page.evaluate(() => {
    window.__ipcEvents = [];
    window.__ipcUnsubscribe = window.desktop.onSessionEvent(event => window.__ipcEvents.push(event));
  });
  // Unknown session id is intentionally ignored by the production renderer projection.
  const event = { type: 'chat-notice', id: 'ipc-smoke-only', level: 'info', message: 'subscription' };
  await app.evaluate(({ BrowserWindow }, { channel, event }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, event), { channel: eventChannels.onSessionEvent, event });
  await page.waitForFunction(() => window.__ipcEvents.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__ipcEvents), [event]);
  await page.evaluate(() => window.__ipcUnsubscribe());
  await app.evaluate(({ BrowserWindow }, { channel, event }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, event), { channel: eventChannels.onSessionEvent, event });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__ipcEvents.length), 1);
  assert.deepEqual(errors, []);
  console.log('PASS IPC: isolated userData, fixture-only bootstrap, sandbox preload, narrow methods, foreign sender rejection, validation, event unsubscribe');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (app) {
    // Only this launched process, and no managed sessions exist in this smoke.
    const child = app.process();
    const kill = setTimeout(() => {
      console.error('IPC smoke close exceeded 5 seconds');
      process.exitCode = 1;
      child.kill('SIGKILL');
    }, 5000);
    try { await app.close(); }
    catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(kill); }
  }
  await rm(profile, { recursive: true, force: true });
}

import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const profile = await mkdtemp(path.join(os.tmpdir(), 'pua-browser-'));
const server = createServer((request, response) => {
  const page = request.url === '/second' ? 'Second' : 'First';
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`<!doctype html><html><head><title>${page} local page</title></head><body><h1>${page}</h1><a href="/second">Second page</a></body></html>`);
});
let app;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const baseURL = `http://127.0.0.1:${address.port}`;
  await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({
    piPath: path.join(root, 'tests/fixtures/mock-pi.mjs'), nodePath: process.execPath,
    args: [], fontSize: 14, recentProjects: [],
  }));
  app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, timeout: 20000 });
  const page = await app.firstWindow({ timeout: 15000 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.getByRole('heading', { name: '开始一个新对话' }).waitFor();
  const panel = page.getByRole('complementary', { name: '右侧面板' });
  if (!await panel.count()) await page.getByRole('banner', { name: '窗口操作栏' }).getByRole('button', { name: '显示右侧面板' }).click();
  await panel.getByRole('button', { name: 'Browser', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.workspace-browser-go')?.disabled);

  const child = async () => app.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.webContents);
    return views.map(view => ({ id: view.webContents.id, url: view.webContents.getURL(), bounds: view.getBounds() }));
  });
  const waitForViewURL = async url => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await app.evaluate(({ webContents }, { id, url: expected }) => webContents.fromId(id)?.getURL() === expected, { id: viewId, url })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`browser view did not reach ${url}`);
  };
  const waitForViewFlag = async flag => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await app.evaluate(({ webContents }, { id, flag: key }) => Boolean(webContents.fromId(id)?.[key]()), { id: viewId, flag })) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`browser view did not expose ${flag}`);
  };
  const created = await child();
  assert.equal(created.length, 1, 'Browser tab creates exactly one native child view');
  const viewId = created[0].id;
  const security = await app.evaluate(({ webContents, session }, id) => {
    const child = webContents.fromId(id);
    const prefs = child.getLastWebPreferences();
    return { isolated: child.session !== session.defaultSession, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity, preload: prefs.preload };
  }, viewId);
  assert.equal(security.isolated, true, 'remote page cannot share the app session');
  assert.deepEqual({ sandbox: security.sandbox, contextIsolation: security.contextIsolation,
    nodeIntegration: security.nodeIntegration, webSecurity: security.webSecurity, preload: security.preload },
  { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: undefined });

  const browser = panel.getByRole('region', { name: 'Browser' });
  const input = browser.getByRole('textbox', { name: '浏览器地址' });
  await input.fill(`${baseURL}/first`);
  await browser.getByRole('button', { name: '前往' }).click();
  await page.waitForFunction(url => document.querySelector('input[aria-label="浏览器地址"]')?.value === url, `${baseURL}/first`);
  await waitForViewURL(`${baseURL}/first`);
  const first = await app.evaluate(async ({ webContents }, id) => {
    const child = webContents.fromId(id);
    return { url: child.getURL(), title: child.getTitle(), globals: await child.executeJavaScript('[typeof require, typeof process]') };
  }, viewId);
  assert.equal(first.url, `${baseURL}/first`);
  assert.equal(first.title, 'First local page');
  assert.deepEqual(first.globals, ['undefined', 'undefined']);
  assert((await child())[0].bounds.width > 0, 'loaded page has visible native bounds');

  await input.fill(`${baseURL}/second`);
  await browser.getByRole('button', { name: '前往' }).click();
  await waitForViewURL(`${baseURL}/second`);
  await waitForViewFlag('canGoBack');
  await browser.getByRole('button', { name: '后退' }).click();
  await page.waitForFunction(url => document.querySelector('input[aria-label="浏览器地址"]')?.value === url, `${baseURL}/first`);
  await waitForViewURL(`${baseURL}/first`);
  await browser.getByRole('button', { name: '前进' }).click();
  await page.waitForFunction(url => document.querySelector('input[aria-label="浏览器地址"]')?.value === url, `${baseURL}/second`);
  await waitForViewURL(`${baseURL}/second`);

  await input.fill('http://example.com/');
  await browser.getByRole('button', { name: '前往' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').textContent(), /HTTPS/);
  assert.equal((await child())[0].url, `${baseURL}/second`, 'remote HTTP never navigates');

  await panel.getByRole('button', { name: '打开右侧标签页' }).click();
  await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.workspace-browser-surface')?.getBoundingClientRect().width === 0);
  assert.deepEqual((await child())[0].bounds, { x: 0, y: 0, width: 0, height: 0 }, 'inactive Browser tab hides native view');
  await panel.getByRole('tab', { name: 'Browser' }).click();
  await page.waitForFunction(() => document.querySelector('.workspace-browser-surface')?.getBoundingClientRect().width > 0);
  assert((await child())[0].bounds.width > 0, 'returning to Browser restores native bounds');
  await panel.getByRole('button', { name: '关闭 Browser 标签页' }).click();
  await page.waitForFunction(() => !document.querySelector('.workspace-browser'));
  assert.deepEqual(await child(), [], 'closing Browser tab removes its native child view');
  assert.deepEqual(errors, []);
  console.log('PASS Browser: loopback navigation/history, sandboxed isolated WebContentsView, URL guard, hidden bounds, and close disposal. No external network.');
} finally {
  if (app) await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

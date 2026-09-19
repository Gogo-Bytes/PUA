import { parseDesktopResult } from '../dist/shared/ipc/desktop-result.js';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'pua-smoke-'));
const profile = path.join(temp, 'profile'); const project = path.join(temp, '项目 with spaces');
await mkdir(profile); await mkdir(project); await mkdir(path.join(project, '.agents/skills'), { recursive: true }); const hooks = path.join(temp, 'empty-hooks'); await mkdir(hooks);
const git = (...args) => exec('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', '-c', 'user.name=Desktop Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: project });
await git('init', '--initial-branch=main'); await writeFile(path.join(project, 'editor.ts'), 'export const mode = "base";\n'); await git('add', 'editor.ts'); await git('commit', '-m', 'fixture');
await writeFile(path.join(project, 'editor.ts'), 'export const mode = "working";\n'); await writeFile(path.join(project, 'notes.md'), '# Review notes\n');
await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({ piPath: path.join(root, 'tests/fixtures/mock-pi.mjs'), nodePath: process.execPath, args: ['--test-argument', 'spaces;$(not-a-shell)'], fontSize: 14, recentProjects: [project] }));
const executablePath = process.env.PI_DESKTOP_TEST_EXECUTABLE;
const app = await electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`], cwd: root, timeout: 20000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', PUA_MOCK_STARTUP_DIALOG: '1' } });
const window = await app.firstWindow({ timeout: 15000 }); window.setDefaultTimeout(15000); const errors = []; window.on('pageerror', error => errors.push(String(error)));
try {
  await window.getByRole('heading', { name: '开始一个新对话' }).waitFor();
  assert.equal(await window.evaluate(() => typeof globalThis.require), 'undefined');
  await window.evaluate(() => { window.__events = []; window.desktop.onSessionEvent(event => window.__events.push(event)); });
  await mkdir(path.join(root, '.agent-work/native-chat/evidence'), { recursive: true });
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/welcome.png') });

  await window.getByRole('button', { name: '项目 with spaces', exact: true }).click();
  await window.getByText('检测到项目资源').waitFor();
  await window.getByRole('radio', { name: /沿用 Pi/ }).check();
  await window.getByRole('textbox', { name: '发送消息' }).fill('你好 Pi\nsecond line');
  await window.getByRole('button', { name: '发送消息', exact: true }).click();
  await window.locator('.chat-pane.active').waitFor();
  await window.getByRole('heading', { name: '启动确认' }).waitFor();
  await window.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await window.getByRole('heading', { name: '原生回复' }).waitFor();
  const firstId = await window.locator('.chat-pane.active').getAttribute('data-session-id');
  await window.locator('code.hljs').first().waitFor();
  assert.equal(await window.locator('code.hljs').count(), 1);
  await window.getByText('读取 · README.md').first().waitFor();
  await window.getByText('运行 · printf final-authoritative', { exact: true }).first().waitFor();
  assert.equal(await window.getByText('ghost', { exact: true }).count(), 0);
  assert.equal(await window.locator('.attachment-chip').count(), 0);
  assert.equal(await window.locator('.chat-transcript img').count(), 0);
  // Real browser clipboard, not a mocked CopyButton, including highlighted code.
  await window.getByRole('button', { name: '复制回复', exact: true }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '## 原生回复\n\n这是 **流式** Markdown。\n\n```ts\nconst ready = true;\n```');
  await window.getByRole('button', { name: '复制代码', exact: true }).first().click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'const ready = true;\n');
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/native-chat.png') });

  if (!await window.getByRole('complementary', { name: '文件与 Git 检查区' }).count()) await window.getByLabel('当前任务操作栏').getByRole('button', { name: '显示 检查器' }).click();
  await window.locator('.changed-files button').filter({ hasText: 'editor.ts' }).click();
  await window.getByRole('button', { name: '引用文件到草稿' }).click();
  assert((await window.getByRole('textbox', { name: '发送消息' }).inputValue()).includes('editor.ts'));
  await window.getByRole('button', { name: '关闭变更面板' }).click();

  // Narrow-window Escape belongs to focused input unless the inspector itself handles it.
  const originalBounds = await app.evaluate(({ BrowserWindow }) => { const browser = BrowserWindow.getAllWindows()[0]; const bounds = browser.getBounds(); browser.setContentSize(1000, 800); return bounds; });
  await window.waitForFunction(() => window.innerWidth <= 1100);
  const chatInput = window.getByRole('textbox', { name: '发送消息' });
  await chatInput.press('Escape');
  assert(await chatInput.evaluate(node => node === document.activeElement), 'closed inspector must not steal chat Escape focus');
  const inspectorToggle = window.locator('.ui-workspace-toolbar button').filter({ hasText: '检查器' }).first();
  await inspectorToggle.waitFor({ state: 'visible' });
  await inspectorToggle.click();
  await chatInput.press('Escape');
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'true', 'input Escape must not close inspector');
  await window.getByRole('button', { name: '关闭变更面板' }).press('Escape');
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'false');
  await window.waitForFunction(() => [...document.querySelectorAll('button')].some(node => getComputedStyle(node).display !== 'none' && node.textContent?.includes('检查器') && node === document.activeElement));
  assert(await inspectorToggle.evaluate(node => node === document.activeElement), 'inspector Escape returns focus to toggle');
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), originalBounds);

  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-dialog');
  await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('heading', { name: '选择测试结果' }).waitFor();
  await window.getByRole('button', { name: '通过' }).click();
  await window.getByText('测试选择：通过').waitFor();
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByText('startup status retained', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-prefill'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="发送消息"]')?.value === '预填草稿');
  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-timeout'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.waitForFunction(() => window.__events.some(e => e.type === 'extension-ui-closed' && e.requestId.startsWith('timeout-')));
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-dialog'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('dialog').waitFor();
  const answered = await window.evaluate(async id => {
    const request = window.__events.filter(event => event.type === 'extension-ui').at(-1).request;
    return window.desktop.respondToExtensionUI(id, { id: request.id, cancelled: true, type: 'prompt', message: 'injected', images: [{ type: 'image', mimeType: 'image/png', data: 'aA==' }] });
  }, firstId);
  assert.deepEqual(parseDesktopResult('respondToExtensionUI', answered), { ok: true, value: null });
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('已取消测试对话', { exact: true }).waitFor();
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  assert.equal(await window.getByText('injected', { exact: true }).count(), 0);
  const injected = parseDesktopResult('respondToExtensionUI', await window.evaluate(id => window.desktop.respondToExtensionUI(id, { id: 'unknown', cancelled: true, type: 'prompt', message: 'injected' }), firstId));
  assert.equal(injected?.ok, false); assert.equal(injected.error.kind, 'application');


  await window.getByRole('textbox', { name: '发送消息' }).fill('slow task');
  await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('button', { name: '停止', exact: false }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('steer this');
  await window.getByRole('textbox', { name: '发送消息' }).press('Enter');
  await window.getByText(/引导 · steer this/).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('follow later');
  await window.getByRole('textbox', { name: '发送消息' }).press('Alt+Enter');
  await window.getByText(/后续 · follow later/).waitFor();
  await window.getByRole('button', { name: '停止', exact: false }).click();
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="发送消息"]')?.value.includes('steer this'));

  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-zero');
  await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('textbox', { name: '零超时输入' }).fill('zero remains answerable');
  await window.getByRole('button', { name: '提交', exact: true }).click();
  await window.getByText('测试选择：zero remains answerable', { exact: true }).waitFor();

  // Exercise actual Virtuoso height changes, not the renderer unit-test stand-in.
  await window.getByRole('textbox', { name: '发送消息' }).fill('/mock-scroll');
  await window.getByRole('button', { name: '发送', exact: false }).click();
  const scroller = window.locator('.chat-pane.active [data-virtuoso-scroller]');
  const scrollRest = () => scroller.evaluate(node => new Promise(resolve => {
    let last = node.scrollTop; let stable = 0;
    const frame = () => { const next = node.scrollTop; stable = Math.abs(next - last) < 1 ? stable + 1 : 0; last = next; if (stable >= 8) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame);
  }));
  await window.getByText(/Paragraph 25:/).waitFor();
  await window.waitForFunction(() => { const s = document.querySelector('.chat-pane.active [data-virtuoso-scroller]'); return s.scrollHeight - s.clientHeight - s.scrollTop < 5; });
  await scroller.hover(); await window.mouse.wheel(0, -650);
  await window.getByRole('button', { name: '回到最新' }).waitFor();
  await window.getByText(/Paragraph 40:/).waitFor();
  const heldPosition = await scroller.evaluate(node => node.scrollTop);
  await window.getByText(/Paragraph 60:/).waitFor();
  assert(Math.abs(await scroller.evaluate(node => node.scrollTop) - heldPosition) < 5, 'streaming must not pull an upward-scrolling reader');
  await window.getByRole('button', { name: '回到最新' }).click();
  await window.getByText('读取 · long.txt', { exact: true }).waitFor();
  const tool = window.locator('.ui-tool-card').filter({ hasText: 'long.txt' });
  await tool.getByRole('button').click();
  const toolImage = tool.getByAltText('工具结果图片'); await toolImage.waitFor();
  await toolImage.evaluate(node => { node.style.height = '240px'; node.style.width = '240px'; });
  await window.waitForFunction(() => { const s = document.querySelector('.chat-pane.active [data-virtuoso-scroller]'); return s.scrollHeight - s.clientHeight - s.scrollTop < 5; });
  await tool.getByRole('button', { name: '复制工具输出' }).click();
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'exact tool output\nsecond line\n');
  await scroller.hover(); await window.mouse.wheel(0, -400);
  await window.getByRole('button', { name: '回到最新' }).waitFor();
  await scrollRest();
  const beforeResize = await scroller.evaluate(node => node.scrollTop);
  await toolImage.evaluate(node => { node.style.height = '360px'; });
  await window.waitForFunction(() => document.querySelector('.ui-tool-card img')?.clientHeight === 360);
  await scrollRest();
  assert(Math.abs(await scroller.evaluate(node => node.scrollTop) - beforeResize) < 5, 'image resize while reading must not force latest');
  await window.getByRole('button', { name: '回到最新' }).click();
  await window.waitForFunction(() => { const s = document.querySelector('.chat-pane.active [data-virtuoso-scroller]'); return s.scrollHeight - s.clientHeight - s.scrollTop < 5; });
  await window.getByRole('button', { name: '回到最新' }).waitFor({ state: 'hidden' });
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/long-stream.png') });

  await scroller.hover(); await window.mouse.wheel(0, -400);
  await window.getByRole('button', { name: '回到最新' }).waitFor(); await scrollRest();
  const backgroundScroll = await scroller.evaluate(node => node.scrollTop);

  assert.deepEqual(parseDesktopResult('sendChatMessage', await window.evaluate(id => window.desktop.sendChatMessage(id, { text: '/mock-exit', attachmentIds: [], delivery: 'prompt' }), firstId)), { ok: true, value: null });
  await window.getByRole('alert').filter({ hasText: 'Pi 对话进程已退出' }).waitFor();
  await window.locator('.chat-pane.active').getByRole('button', { name: '复制回复', exact: true }).last().click();
  const lastReply = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert(lastReply.includes('Paragraph 100:'), 'retained reply remains visible and copyable after exit');
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/exited-chat.png') });
  await window.getByRole('button', { name: '兼容终端', exact: true }).click();
  await window.getByRole('radio', { name: /兼容终端/ }).check();
  await window.getByRole('dialog').getByRole('button', { name: '打开兼容终端 ↗', exact: true }).click();
  await window.waitForFunction(() => window.__events.some(event => event.type === 'terminal-data' && event.data.includes('MOCK_PI_READY')));
  const terminalId = await window.locator('.terminal-pane.active').getAttribute('data-session-id'); assert.notEqual(firstId, terminalId);
  const terminalOutput = await window.evaluate(() => window.__events.filter(event => event.type === 'terminal-data').map(event => event.data).join(''));
  assert(terminalOutput.includes('spaces;$(not-a-shell)'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 800));
  await window.waitForFunction(() => window.innerWidth <= 1100);
  assert.equal(await window.getByLabel('当前任务操作栏').getByRole('button', { name: '显示 检查器' }).getAttribute('aria-expanded'), 'false');
  const terminalInput = window.locator('.terminal-pane.active .xterm-helper-textarea');
  await terminalInput.press('Escape');
  assert(await terminalInput.evaluate(node => node === document.activeElement), 'closed inspector must not steal real xterm Escape focus');
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), originalBounds);
  await window.locator('.terminal-pane.active .xterm-helper-textarea').press('Shift+Enter');
  await window.evaluate(id => window.desktop.write(id, '\x02'), terminalId);
  await window.waitForFunction(() => window.__events.some(event => event.type === 'terminal-data' && event.data.includes('INPUT_BASE64=')));
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/terminal-fallback.png') });

  const denied = parseDesktopResult('openExternal', await window.evaluate(() => window.desktop.openExternal('file:///etc/passwd')));
  assert.equal(denied?.ok, false); assert.equal(denied.error.kind, 'validation'); assert.equal(denied.error.code, 'INVALID_ARGUMENTS');
  await window.evaluate(id => window.desktop.write(id, '\x04'), terminalId);
  await window.waitForFunction(id => window.__events.some(event => event.id === id && event.type === 'exit'), terminalId);
  assert.deepEqual(errors, []);
  console.log('PASS: native RPC chat, exact reply/code/tool clipboard, 100-paragraph stream follow/scroll-away/jump/resize/background restoration, exited transcript copy, zero-timeout UI, queue/stop, Git feedback, PTY fallback, sandbox and cleanup.');
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
  await app.close().catch(() => {}); await rm(temp, { recursive: true, force: true });
}

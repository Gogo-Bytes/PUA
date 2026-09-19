import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveRuntime } from '../dist/platform/pi/runtime/discovery.js';

const root = process.cwd();
const runtime = resolveRuntime({ piPath: process.env.PI_DESKTOP_TEST_PI || '', nodePath: process.env.PI_DESKTOP_TEST_NODE || '', args: [] });
let packageRoot = path.dirname(runtime.args[0] || runtime.executable); let modal; let rpcDemo;
for (let depth = 0; depth < 6; depth++) {
  const modalCandidate = path.join(packageRoot, 'examples/extensions/modal-editor.ts'); const rpcCandidate = path.join(packageRoot, 'examples/extensions/rpc-demo.ts');
  try { await access(modalCandidate); await access(rpcCandidate); modal = modalCandidate; rpcDemo = rpcCandidate; break; } catch { packageRoot = path.dirname(packageRoot); }
}
if (!modal || !rpcDemo) throw new Error('This integration test requires installed Pi official modal-editor.ts and rpc-demo.ts examples.');
const temp = await mkdtemp(path.join(os.tmpdir(), 'pua-real-')); const profile = path.join(temp, 'desktop'); const agentDir = path.join(temp, 'agent'); const project = path.join(temp, 'project');
await Promise.all([mkdir(profile), mkdir(agentDir), mkdir(project)]);
const timeoutExtension = path.join(temp, 'offline-dialogs.ts');
await writeFile(timeoutExtension, `export default function(pi) {
  pi.registerCommand('pua-timeout', { handler: async (_args, ctx) => { await ctx.ui.input('Offline timed input', 'expires', { timeout: 200 }); ctx.ui.notify('Offline timeout completed', 'info'); } });
  pi.registerCommand('pua-zero', { handler: async (_args, ctx) => { const answer = await ctx.ui.input('Offline zero timeout', 'still answerable', { timeout: 0 }); ctx.ui.notify('Offline zero: ' + answer, 'info'); } });
  pi.registerCommand('pua-confirm', { handler: async (_args, ctx) => { const answer = await ctx.ui.confirm('Offline confirm', 'No model call'); ctx.ui.notify('Offline confirm: ' + answer, 'info'); } });
}`);
await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({ piPath: runtime.source, nodePath: runtime.executable, args: ['--offline', '--no-session', '-e', modal, '-e', rpcDemo, '-e', timeoutExtension], fontSize: 14, recentProjects: [project] }));
const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, timeout: 20000, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' } });
try {
  const window = await app.firstWindow({ timeout: 15000 }); window.setDefaultTimeout(20000); const errors = []; window.on('pageerror', error => errors.push(String(error)));
  await window.getByTitle(project, { exact: true }).waitFor();
  await window.evaluate(() => { window.__events = []; window.desktop.onSessionEvent(event => window.__events.push(event)); });

  // Native RPC path: capability handshake plus official extension UI, with no model request.
  await window.getByTitle(project, { exact: true }).click();
  await window.getByRole('region', { name: '新对话' }).waitFor();
  await window.locator('.pending-trust-status').waitFor({ state: 'hidden' });
  await window.getByRole('textbox', { name: '发送消息' }).fill('/rpc-input'); await window.getByRole('button', { name: '发送消息', exact: true }).click();
  await window.getByRole('dialog').waitFor();
  await window.getByRole('dialog').getByRole('textbox').fill('offline value');
  await window.getByRole('dialog').getByRole('button', { name: '提交' }).click();

  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByText('Loaded and ready.', { exact: true }).waitFor();
  await window.getByText('Turns: 0', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/rpc-input'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('dialog').waitFor(); await window.getByRole('dialog').press('Escape');
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/pua-timeout'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByText('Offline timeout completed', { exact: true }).waitFor();
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/pua-zero'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('dialog').getByRole('textbox').fill('answer');
  await window.getByRole('dialog').getByRole('button', { name: '提交' }).click();
  await window.getByText('Offline zero: answer', { exact: true }).waitFor();
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/pua-confirm'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await window.getByText('Offline confirm: true', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/rpc-editor'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.getByRole('dialog').getByRole('textbox').fill('offline editor value');
  await window.getByRole('dialog').getByRole('button', { name: '提交' }).click();
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  await window.getByText('Pi 已就绪', { exact: true }).waitFor();
  await window.getByRole('textbox', { name: '发送消息' }).fill('/rpc-prefill'); await window.getByRole('button', { name: '发送', exact: false }).click();
  await window.waitForFunction(() => document.querySelector('textarea[aria-label="发送消息"]')?.value === 'This text was set by the rpc-demo extension.');
  await window.waitForFunction(() => document.querySelector('.ui-composer-submit')?.disabled === false);
  await mkdir(path.join(root, '.agent-work/native-chat/evidence'), { recursive: true });
  await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/real-pi-idle-prefill.png') });
  await window.getByRole('button', { name: '更多任务操作', exact: true }).click();
  await window.getByRole('menuitem', { name: '归档并关闭任务', exact: true }).click();
  await window.locator('.chat-pane').waitFor({ state: 'detached' });

  // Explicit compatibility terminal: TUI-only custom editor remains functional.
  await window.getByRole('button', { name: /中打开兼容终端/ }).click();
  await window.getByRole('dialog').getByRole('button', { name: /打开兼容终端/ }).click();
  await window.waitForFunction(() => window.__events.some(event => event.type === 'terminal-data' && event.data.includes(' INSERT ')), undefined, { timeout: 30000 });
  const id = await window.locator('.terminal-pane.active').getAttribute('data-session-id');
  await window.evaluate(() => { window.__events = []; }); await window.locator('.terminal-pane.active .xterm-helper-textarea').press('Escape'); await window.waitForFunction(() => window.__events.some(event => event.type === 'terminal-data' && event.data.includes(' NORMAL ')));
  await window.locator('.terminal-pane.active .xterm-helper-textarea').press('i'); await window.waitForFunction(() => window.__events.some(event => event.type === 'terminal-data' && event.data.includes(' INSERT ')));
  await mkdir(path.join(root, '.agent-work/native-chat/evidence'), { recursive: true }); await window.screenshot({ path: path.join(root, '.agent-work/native-chat/evidence/real-pi-dual-mode.png') });
  await window.evaluate(id => window.desktop.write(id, '/quit\r'), id); await window.waitForFunction(id => window.__events.some(event => event.id === id && event.type === 'exit'), id);
  assert.deepEqual(errors, []);
  console.log('PASS: installed Pi isolated RPC handshake + official extension UI, and explicit terminal fallback with official modal editor. No model request or user config modification.');
} finally { await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await app.close().catch(() => {}); await rm(temp, { recursive: true, force: true }); }

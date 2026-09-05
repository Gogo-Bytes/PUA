import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { resolveRuntime } from '../dist/main/runtime.js';

const root = process.cwd();
const runtime = resolveRuntime({ piPath: process.env.PI_DESKTOP_TEST_PI || '', nodePath: process.env.PI_DESKTOP_TEST_NODE || '', args: [] });
let packageRoot = path.dirname(runtime.args[0] || runtime.executable);
let example;
for (let depth = 0; depth < 6; depth++) {
  const candidate = path.join(packageRoot, 'examples/extensions/modal-editor.ts');
  try { await access(candidate); example = candidate; break; } catch { packageRoot = path.dirname(packageRoot); }
}
if (!example) throw new Error('This integration test requires the installed Pi official examples/extensions/modal-editor.ts. Set PI_DESKTOP_TEST_PI to its CLI path.');
const temp = await mkdtemp(path.join(os.tmpdir(), 'pi-desktop-real-'));
const profile = path.join(temp, 'desktop');
const agentDir = path.join(temp, 'agent');
const project = path.join(temp, 'project');
await Promise.all([mkdir(profile), mkdir(agentDir), mkdir(project)]);
await writeFile(path.join(profile, 'desktop-settings.json'), JSON.stringify({
  piPath: runtime.source, nodePath: runtime.executable, args: ['--offline', '--no-session', '-e', example], fontSize: 14, recentProjects: [],
}));
const app = await electron.launch({ args: [root, `--user-data-dir=${profile}`], cwd: root, timeout: 20000,
  env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' } });
try {
  const window = await app.firstWindow({ timeout: 15000 });
  window.setDefaultTimeout(15000);
  const errors = [];
  window.on('pageerror', error => errors.push(String(error)));
  await window.getByRole('button', { name: '打开一个项目' }).waitFor();
  await window.evaluate(() => { window.__output = ''; window.__exited = false; window.desktop.onTerminalEvent(event => { if (event.type === 'data') window.__output += event.data; else window.__exited = true; }); });
  await window.getByRole('button', { name: '打开一个项目' }).click();
  await window.getByRole('textbox', { name: '项目文件夹', exact: true }).fill(project);
  await window.getByRole('button', { name: '打开工作空间' }).click();
  // The official extension replaces Pi's editor, a capability RPC explicitly does not render.
  await window.waitForFunction(() => window.__output.includes(' INSERT '), undefined, { timeout: 30000 });
  const id = await window.locator('.terminal-pane.active').getAttribute('data-session-id');
  await window.evaluate(() => { window.__output = ''; });
  await window.locator('.terminal-pane.active .xterm-helper-textarea').press('Escape');
  await window.waitForFunction(() => window.__output.includes(' NORMAL '));
  await window.locator('.terminal-pane.active .xterm-helper-textarea').press('i');
  await window.waitForFunction(() => window.__output.includes(' INSERT '));
  await window.evaluate(() => { window.__output = ''; });
  await window.evaluate(id => window.desktop.write(id, '/settings\r'), id);
  await window.waitForFunction(() => /Settings|设置|Auto.compact|auto.compact|Theme/.test(window.__output));
  await mkdir(path.join(root, '.agent-work/desktop/evidence'), { recursive: true });
  await window.screenshot({ path: path.join(root, '.agent-work/desktop/evidence/real-pi-settings.png') });
  await window.evaluate(() => { window.__output = ''; });
  await window.evaluate(id => window.desktop.write(id, '\x1b'), id);
  // Wait for the UI transition, rather than merging Escape with the next key in Pi's input parser.
  await window.waitForFunction(() => window.__output.includes(' INSERT '));
  await window.evaluate(id => window.desktop.write(id, '/quit\r'), id);
  await window.waitForFunction(() => window.__exited);
  assert.deepEqual(errors, []);
  console.log('PASS: installed Pi, isolated config, native startup, official custom editor INSERT/NORMAL transitions, native /settings, and /quit. No model request or user config modification.');
} finally {
  // Direct app.exit bypasses window close confirmation; test-only cleanup of an isolated no-session Pi.
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await app.close().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}

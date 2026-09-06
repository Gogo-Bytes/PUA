import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd(); const fixture = path.join(root, 'tests/fixtures/lifecycle-pi.mjs'); await chmod(fixture, 0o755);
for (const mode of ['close', 'handshake', 'renderer', 'host', 'terminal-close']) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pua-lifecycle-')); const log = path.join(temporary, 'pids.jsonl');
  await writeFile(path.join(temporary, 'desktop-settings.json'), JSON.stringify({ piPath: fixture, nodePath: process.execPath, args: [], fontSize: 13, recentProjects: [] }));
  const app = await electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: ['.', `--user-data-dir=${temporary}`], cwd: root, env: { ...process.env, PI_DESKTOP_USER_DATA_DIR: temporary, PUA_LIFECYCLE_LOG: log, PUA_LIFECYCLE_CASE: mode } });
  let records = [];
  try {
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '打开项目', exact: false }).first().click();
    await page.getByRole('textbox', { name: '项目文件夹', exact: true }).fill(temporary);
    if (mode === 'terminal-close') {
      await page.getByRole('radio', { name: /兼容终端/ }).check();
      await page.getByRole('button', { name: '打开兼容终端' }).click();
      await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    } else await page.getByRole('button', { name: '开始对话' }).click();
    const deadline = Date.now() + 10000;
    do { try { records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); } catch {} if (records.length >= 3) break; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
    assert.equal(records.length, 3, 'Pi and both descendant fixtures started');
    if (mode === 'close' || mode === 'terminal-close') await app.close();
    if (mode === 'renderer') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
    if (mode === 'host') await app.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), records[0].host);
    const pids = records.map(record => record.pid ?? record.descendant);
    const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const stopDeadline = Date.now() + 8000;
    while (pids.some(alive) && Date.now() < stopDeadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(pids.filter(alive), [], `${mode}: no orphan Pi or descendant`);
    console.log(`PASS lifecycle: ${mode}`);
  } finally {
    await app.close().catch(() => {});
    for (const record of records) { try { process.kill(record.pid ?? record.descendant, 'SIGKILL'); } catch {} }
    await rm(temporary, { recursive: true, force: true });
  }
}

import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const modes = ['close', 'handshake', 'renderer', 'host', 'terminal-close'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const validPid = pid => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid;

async function readRecords(log) {
  try {
    // Ignore an in-flight final append; malformed complete records must fail.
    const text = await readFile(log, 'utf8');
    return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function within(task, milliseconds, label) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label}: deadline exceeded (${milliseconds}ms)`);
        controller.abort(error);
        reject(error);
      }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function assertStopped(pids, mode, milliseconds = 8000, signal) {
  signal?.throwIfAborted();
  assert.ok(pids.length > 0 && pids.every(validPid), `${mode}: valid owned PIDs required`);
  const deadline = Date.now() + milliseconds;
  while (true) {
    signal?.throwIfAborted();
    if (!pids.some(alive) || Date.now() >= deadline) break;
    await pause(50);
  }
  signal?.throwIfAborted();
  assert.deepEqual(pids.filter(alive), [], `${mode}: no orphan Pi or descendant`);
}

async function ownedTree(root) {
  if (!validPid(root)) return [];
  const text = await new Promise((resolve, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid='], { timeout: 1000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const rows = text.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const owned = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of rows) if (owned.has(parent) && !owned.has(pid)) { owned.add(pid); changed = true; }
  }
  return [...owned];
}

async function cleanup(app, appPid, log) {
  // Snapshot while parent links still exist; the journal also covers detached or
  // already reparented fixture children, including those that never became ready.
  const failures = [];
  const owned = new Set(validPid(appPid) ? [appPid] : []);
  for (const pid of await ownedTree(appPid).catch(error => { failures.push(error); return []; })) owned.add(pid);
  if (app) await within(() => app.close(), 5000, 'Electron cleanup').catch(error => { failures.push(error); });
  const records = await readRecords(log).catch(error => { failures.push(error); return []; });
  const events = await readRecords(`${log}.events`).catch(error => { failures.push(error); return []; });
  for (const row of records) {
    if (validPid(row.pid ?? row.descendant)) owned.add(row.pid ?? row.descendant);
    if (validPid(row.host)) owned.add(row.host);
  }
  for (const row of events) if (row.event === 'spawn' && validPid(row.pid)) owned.add(row.pid);
  for (const pid of owned) {
    try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failures.push(error); }
  }
  if (owned.size) await assertStopped([...owned], 'fallback cleanup', 3000).catch(error => { failures.push(error); });
  if (failures.length) throw new AggregateError(failures, 'lifecycle fallback cleanup failed');
}

async function runScenario(root, fixture, mode) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pua-lifecycle-'));
  const log = path.join(temporary, 'pids.jsonl');
  let app;
  let appPid;
  let failure;
  try {
    await writeFile(path.join(temporary, 'desktop-settings.json'), JSON.stringify({ piPath: fixture, nodePath: process.execPath, args: [], fontSize: 13, recentProjects: [temporary] }));
    app = await electron.launch({
      executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: ['.', `--user-data-dir=${temporary}`], cwd: root, timeout: 10000,
      env: { ...process.env, PI_DESKTOP_USER_DATA_DIR: temporary, PUA_LIFECYCLE_LOG: log, PUA_LIFECYCLE_CASE: mode },
    });
    appPid = app.process().pid;
    await within(async signal => {
      const page = await app.firstWindow({ timeout: 5000 });
      signal.throwIfAborted();
      page.setDefaultTimeout(5000);
      await page.getByTitle(temporary, { exact: true }).waitFor();
      if (mode === 'terminal-close') {
        await page.getByRole('button', { name: /中打开兼容终端/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: /打开兼容终端/ }).click();
        await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
      } else {
        await page.getByTitle(temporary, { exact: true }).click();
        const draft = page.getByRole('textbox', { name: '发送消息', exact: true });
        await page.locator('.pending-trust-status').waitFor({ state: 'hidden' });
        await draft.fill('start lifecycle');
        await draft.press('Enter');
      }
      const deadline = Date.now() + 10000;
      let records = [];
      do {
        signal.throwIfAborted();
        records = await readRecords(log);
        const error = (await readRecords(`${log}.events`)).find(row => row.event === 'error');
        if (error) throw new Error(`lifecycle ${mode}: fixture failed: ${error.message}`);
        if (records.length >= 3) break;
        await pause(25);
      } while (Date.now() < deadline);
      signal.throwIfAborted();
      assert.equal(records.length, 3, `${mode}: Pi and both descendant fixtures started`);
      const pids = records.map(record => record.pid ?? record.descendant);
      assert.equal(new Set(pids).size, 3, `${mode}: three distinct fixture PIDs`);
      assert.deepEqual(records.slice(1).map(record => record.detached).sort(), [false, true]);
      if (mode === 'close' || mode === 'terminal-close') await app.close();
      if (mode === 'renderer') await app.evaluate(({ BrowserWindow, dialog }) => {
        // The expected native crash notification is modal on macOS. Do not let
        // an unattended notification block teardown after the PID assertion.
        dialog.showErrorBox = (title, content) => console.error(`lifecycle crash notification: ${title}: ${content}`);
        BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
      });
      if (mode === 'host') {
        assert.ok(validPid(records[0].host), 'fixture host PID required');
        await app.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), records[0].host);
      }
      // Always assert product cleanup BEFORE fallback cleanup can mask a leak.
      await assertStopped(pids, mode, 8000, signal);
    }, 30000, `lifecycle ${mode}`);
    console.log(`PASS lifecycle: ${mode} (3 started, 3 stopped)`);
  } catch (error) {
    failure = error;
    console.error(`FAIL lifecycle: ${mode}`, error);
    console.error('fixture records:', await readRecords(log).catch(String));
    console.error('fixture events:', await readRecords(`${log}.events`).catch(String));
  } finally {
    try { await cleanup(app, appPid, log); }
    catch (error) { failure = failure ? new AggregateError([failure, error], `${mode}: scenario and cleanup failed`) : error; }
    // Keep diagnostics when cleanup fails; successful and ordinary failed runs
    // emit evidence above and remove only this test's temporary userData.
    if (!failure || !(failure instanceof AggregateError)) await rm(temporary, { recursive: true, force: true });
    else console.error(`Retained lifecycle diagnostics: ${temporary}`);
  }
  if (failure) throw failure;
}

export async function main(args = process.argv.slice(2)) {
  if (process.platform !== 'darwin') throw new Error(`Lifecycle release gate unsupported on ${process.platform}; package/dist blocked until this platform is validated (no skip).`);
  let selected = modes;
  let repeat = 1;
  for (const arg of args) {
    if (arg.startsWith('--case=') && modes.includes(arg.slice(7))) selected = [arg.slice(7)];
    else if (/^--repeat=([1-9]|10)$/.test(arg)) repeat = Number(arg.slice(9));
    else throw new Error(`Unknown lifecycle argument: ${arg}`);
  }
  const root = process.cwd();
  const fixture = path.join(root, 'tests/fixtures/lifecycle-pi.mjs');
  await chmod(fixture, 0o755);
  for (let iteration = 0; iteration < repeat; iteration++) {
    for (const mode of selected) await runScenario(root, fixture, mode);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

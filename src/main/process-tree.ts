import { execFile } from 'node:child_process';

interface ProcessRow { pid: number; parent: number; group: number; state: string }
async function processes(): Promise<ProcessRow[]> {
  const output = await new Promise<string>((resolve, reject) => execFile('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat='], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  return output.trim().split('\n').map(line => { const [pid, parent, group, state] = line.trim().split(/\s+/); return { pid: Number(pid), parent: Number(parent), group: Number(group), state }; });
}
async function descendants(root: number): Promise<ProcessRow[]> {
  const rows = await processes();
  const owned = new Set([root]);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true; } }
  return rows.filter(row => owned.has(row.pid));
}
function signal(target: number, force: boolean) {
  try { process.kill(target, force ? 'SIGKILL' : 'SIGTERM'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

/** Root must be a child launched in its own POSIX group. Snapshot before signalling:
 * Pi's normal bash tool creates additional detached groups beneath that child. */
export async function terminateProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    for (const force of [false, true]) await new Promise<void>(resolve => execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { timeout: 1500 }, () => resolve()));
    return;
  }
  const rows = await descendants(pid);
  const targets = new Set([-pid, ...rows.map(row => row.group === row.pid ? -row.pid : row.pid)]);
  for (const target of targets) signal(target, false);
  await new Promise(resolve => setTimeout(resolve, 350));
  for (const target of targets) signal(target, true);
  const deadline = Date.now() + 1000;
  do {
    const live = (await processes()).some(row => !row.state?.startsWith('Z') && (targets.has(row.pid) || targets.has(-row.group)));
    if (!live) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('Pi process tree did not terminate; session ownership retained');
}

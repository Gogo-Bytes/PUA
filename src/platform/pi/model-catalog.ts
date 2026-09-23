import { execFile } from 'node:child_process';
import type { ChatModel } from '../../shared/ipc/conversation.js';
import type { RuntimeInfo } from '../../shared/ipc/desktop-api.js';

/** Parse Pi's stable --list-models table, failing closed if its shape changes. */
export function parsePiModelCatalog(output: string): ChatModel[] {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = lines.shift()?.split(/\s{2,}/);
  if (!header || header[0] !== 'provider' || header[1] !== 'model' || !header.includes('thinking')) throw new Error('Pi 返回了无法识别的模型目录');
  const thinkingIndex = header.indexOf('thinking');
  const models: ChatModel[] = [];
  for (const line of lines) {
    const columns = line.split(/\s{2,}/);
    if (columns.length !== header.length || !columns[0] || !columns[1] || !['yes', 'no'].includes(columns[thinkingIndex])) throw new Error('Pi 返回了无法识别的模型目录');
    models.push({ provider: columns[0], id: columns[1], name: columns[1], reasoning: columns[thinkingIndex] === 'yes' });
  }
  return models;
}

/** Use Pi itself to resolve its configured catalog, offline and without extensions/session creation. */
export function listPiModelCatalog(runtime: RuntimeInfo, cwd: string): Promise<ChatModel[]> {
  // Keep only the resolved JS entry point when Node launches Pi. Arbitrary user
  // session flags/prompts/extensions must never run in this catalog-only probe.
  const entry = runtime.args[0] && /\.[cm]?js$/i.test(runtime.args[0]) ? [runtime.args[0]] : [];
  const args = [...entry, '--offline', '--no-session', '--no-extensions', '--list-models'];
  return new Promise((resolve, reject) => {
    execFile(runtime.executable, args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PI_OFFLINE: '1' },
      windowsHide: true,
    }, (error, stdout) => {
      if (error) { reject(new Error('无法读取 Pi 模型目录；可继续使用 Pi 默认模型。')); return; }
      try { resolve(parsePiModelCatalog(stdout)); }
      catch { reject(new Error('Pi 模型目录格式无法识别；可继续使用 Pi 默认模型。')); }
    });
  });
}

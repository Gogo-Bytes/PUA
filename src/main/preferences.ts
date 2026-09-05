import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from '../shared/contracts.js';

export const defaults: Preferences = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: [] };

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('无效设置');
  const v = value as Record<string, unknown>;
  if (typeof v.piPath !== 'string' || typeof v.nodePath !== 'string' ||
      !Array.isArray(v.args) || !v.args.every(arg => typeof arg === 'string' && !arg.includes('\0')) ||
      typeof v.fontSize !== 'number' || !Number.isFinite(v.fontSize) || v.fontSize < 10 || v.fontSize > 28 ||
      !Array.isArray(v.recentProjects) || !v.recentProjects.every(p => typeof p === 'string') ||
      v.piPath.includes('\0') || v.nodePath.includes('\0')) throw new Error('设置格式错误：字体范围为 10–28，参数应为 JSON 字符串数组。');
  return { piPath: v.piPath, nodePath: v.nodePath, args: [...v.args], fontSize: v.fontSize, recentProjects: [...new Set(v.recentProjects as string[])].slice(0, 20) };
}

export class PreferencesStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<Preferences> {
    try { return validatePreferences({ ...defaults, ...JSON.parse(await readFile(this.file, 'utf8')) }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults, args: [], recentProjects: [] };
      throw new Error(`无法读取桌面设置 ${this.file}: ${String(error)}`);
    }
  }
  write(preferences: Preferences): Promise<void> {
    const validated = validatePreferences(preferences);
    const next = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(validated, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    });
    this.queue = next;
    return next;
  }
}

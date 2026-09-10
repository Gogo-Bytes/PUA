import { validatePreferences } from '../../shared/ipc/schemas.js';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { PreferenceValues, PreferencesPersistencePort } from '../../modules/preferences/index.js';

// Defaults apply before the shared edge parser, including legacy JSON spread semantics.
export const defaults: PreferenceValues = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: [], theme: 'system' };

/** Disk compatibility and serial IO only; current values belong to PreferencesApplication. */
export class JsonPreferencesStorage implements PreferencesPersistencePort {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<PreferenceValues> {
    try { return validatePreferences({ ...defaults, ...JSON.parse(await readFile(this.file, 'utf8')) }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults, args: [], recentProjects: [] };
      throw new Error(`无法读取桌面设置 ${this.file}: ${String(error)}`);
    }
  }
  write(preferences: PreferenceValues): Promise<void> {
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

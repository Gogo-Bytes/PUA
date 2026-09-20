import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectResourceInfo } from '../../shared/ipc/desktop-api.js';
import { expandHome } from './expand-home.js';

const candidates = ['.pi/settings.json', '.pi/extensions', '.pi/skills', '.pi/prompts', '.pi/packages', '.agents/skills'];
async function exists(value: string): Promise<boolean> { try { await access(value); return true; } catch { return false; } }
async function skillNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)).map(entry => entry.name).slice(0, 128);
  } catch { return []; }
}

/** Detect resources that make Pi's non-interactive project-trust choice meaningful. */
export async function inspectProjectResources(cwd: string): Promise<ProjectResourceInfo> {
  let directory = path.resolve(expandHome(cwd));
  const paths: string[] = [];
  const skills = new Set<string>();
  while (true) {
    for (const candidate of candidates) {
      const value = path.join(directory, candidate);
      if (await exists(value)) {
        paths.push(value);
        if (candidate.endsWith('/skills')) for (const name of await skillNames(value)) skills.add(name);
      }
    }
    const parent = path.dirname(directory);
    if (await exists(path.join(directory, '.git')) || parent === directory) break;
    directory = parent;
  }
  return { hasResources: paths.length > 0, paths, ...(skills.size ? { skills: [...skills].sort().map(name => ({ name, source: 'skill' as const })) } : {}) };
}

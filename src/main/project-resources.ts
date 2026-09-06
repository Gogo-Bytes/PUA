import { access } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectResourceInfo } from '../shared/contracts.js';
import { expandHome } from './runtime.js';

const candidates = ['.pi/settings.json', '.pi/extensions', '.pi/skills', '.pi/prompts', '.pi/packages', '.agents/skills'];
async function exists(value: string): Promise<boolean> { try { await access(value); return true; } catch { return false; } }

/** Detect resources that make Pi's non-interactive project-trust choice meaningful. */
export async function inspectProjectResources(cwd: string): Promise<ProjectResourceInfo> {
  let directory = path.resolve(expandHome(cwd));
  const paths: string[] = [];
  while (true) {
    for (const candidate of candidates) { const value = path.join(directory, candidate); if (await exists(value)) paths.push(value); }
    const parent = path.dirname(directory);
    if (await exists(path.join(directory, '.git')) || parent === directory) break;
    directory = parent;
  }
  return { hasResources: paths.length > 0, paths };
}

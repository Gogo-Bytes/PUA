import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expandHome } from './expand-home.js';

export async function prepareProject(cwd: string): Promise<{ cwd: string; title: string }> {
  const directory = path.resolve(expandHome(cwd));
  if (!(await stat(directory)).isDirectory()) throw new Error('项目路径不是目录');
  return { cwd: directory, title: path.basename(directory) || directory };
}


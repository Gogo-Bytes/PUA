import path from 'node:path';
import os from 'node:os';

export function expandHome(value: string, home = os.homedir()): string {
  return value === '~' ? home : value.startsWith('~/') || value.startsWith('~\\') ? path.join(home, value.slice(2)) : value;
}


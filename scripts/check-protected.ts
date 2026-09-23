import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const foundationCommit = '6788fc550d36bed9dc4f9ad86aa5c6892524d541';
const protectedDirectories = ['src/renderer/ui', 'tests/component-preview'];

/** UI migration baseline plus approved interaction follow-ups: compare membership and bytes. */
export function checkProtectedFiles(root: string, manifest: Record<string, string>): string[] {
  const errors: string[] = [];
  const walk = (relative: string): string[] => {
    try {
      return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
        const file = `${relative}/${entry.name}`;
        return entry.isDirectory() ? walk(file) : [file];
      });
    } catch { errors.push(`Missing protected directory: ${relative}`); return []; }
  };
  const files = protectedDirectories.flatMap(walk);
  try {
    files.push(...readdirSync(path.join(root, 'tests')).filter(name => /^component-.*\.test\.tsx$/.test(name)).map(name => `tests/${name}`));
  } catch { errors.push('Missing tests directory'); }
  const actual = new Set(files);
  for (const file of actual) {
    if (!Object.hasOwn(manifest, file)) { errors.push(`Added protected file: ${file}`); continue; }
    const absolute = path.join(root, file);
    if (!lstatSync(absolute).isFile()) { errors.push(`Non-regular protected file: ${file}`); continue; }
    if (createHash('sha256').update(readFileSync(absolute)).digest('hex') !== manifest[file]) errors.push(`Changed protected file: ${file}`);
  }
  for (const file of Object.keys(manifest)) if (!actual.has(file)) errors.push(`Deleted protected file: ${file}`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest: Record<string, string> = JSON.parse(readFileSync(new URL('./refactor-protected-hashes.json', import.meta.url), 'utf8'));
  const errors = checkProtectedFiles(process.cwd(), manifest);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`PASS frozen file set + SHA256: ${Object.keys(manifest).length}/${Object.keys(manifest).length}; migration checkpoint ${foundationCommit}`);
}

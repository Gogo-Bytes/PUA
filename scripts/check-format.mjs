import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';

const root = process.cwd();
const write = process.argv.includes('--write');
const supported = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|json|css|scss|html|ya?ml)$/i;

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'buffer' }).toString('utf8').split('\0').filter(Boolean);
}

function changedFiles() {
  const working = [
    ...git('diff', '--name-only', '-z'),
    ...git('diff', '--cached', '--name-only', '-z'),
    ...git('ls-files', '--others', '--exclude-standard', '-z'),
  ];
  const base = process.env.FORMAT_BASE_REF;
  if (base) return [...new Set([...git('diff', '--name-only', '-z', `${base}...HEAD`), ...working])];
  if (working.length) return [...new Set(working)];

  try {
    return git('diff', '--name-only', '-z', 'HEAD^', 'HEAD');
  } catch {
    return git('ls-files', '-z');
  }
}

const files = changedFiles().filter(file => {
  if (!supported.test(file)) return false;
  const absolute = path.join(root, file);
  return existsSync(absolute) && statSync(absolute).isFile();
});
const unformatted = [];

for (const file of files) {
  const absolute = path.join(root, file);
  const source = readFileSync(absolute, 'utf8');
  const options = { ...(await prettier.resolveConfig(absolute)), filepath: absolute };
  if (await prettier.check(source, options)) continue;
  unformatted.push(file);
  if (write) writeFileSync(absolute, await prettier.format(source, options));
}

if (unformatted.length) {
  console.error(`${write ? 'Formatted' : 'Unformatted'} files:\n${unformatted.map(file => `  ${file}`).join('\n')}`);
  if (!write) process.exitCode = 1;
} else {
  console.log(`Format check passed (${files.length} changed files).`);
}

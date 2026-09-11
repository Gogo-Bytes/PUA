export function referencePaths(paths: string[]): string {
  // This is text for Pi's editor, not a shell command. Newlines must never become submits.
  return paths.map(value => `@${JSON.stringify(value)}`).join(' ') + (paths.length ? ' ' : '');
}

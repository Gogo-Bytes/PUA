export interface KeyInput { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; }

/** Pi understands these modified-Enter sequences even without a full Kitty keyboard implementation. */
export function modifiedEnter(event: KeyInput): string | undefined {
  if (event.key !== 'Enter' || event.metaKey) return;
  const modifier = 1 + (event.shiftKey ? 1 : 0) + (event.altKey ? 2 : 0) + (event.ctrlKey ? 4 : 0);
  return modifier > 1 ? `\x1b[13;${modifier}u` : undefined;
}

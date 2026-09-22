export interface ComposerSuggestion { id: string; prefix: '/' | '@'; label: string; insertText: string; description?: string; atStartOnly?: boolean }
export function completionToken(value: string, start: number, end = start) {
  if (start !== end) return null;
  const match = value.slice(0, start).match(/(?:^|\s)([/@])([^\s]*)$/);
  if (!match) return null;
  // Replace the entire token when the caret is in its middle; preserve later text.
  const tail = value.slice(start).match(/^[^\s]*/)?.[0].length ?? 0;
  return { prefix: match[1], query: match[2], start: start - match[2].length - 1, end: start + tail };
}

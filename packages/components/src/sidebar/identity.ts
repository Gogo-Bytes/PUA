/** First ID wins, input ordering preserved. Labels and paths are never identity. */
export function uniqueById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

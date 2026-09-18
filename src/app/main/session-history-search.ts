import type { HistorySearchResult } from '../../shared/ipc/desktop-api.js';

const MAX_SNIPPET = 220;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function messageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => {
    const block = record(item);
    if (!block) return '';
    if (block.type === 'text') return text(block.text);
    if (block.type === 'thinking') return text(block.thinking);
    return '';
  }).filter(Boolean).join('\n');
  if (message.role === 'branchSummary' || message.role === 'compactionSummary') return text(message.summary);
  if (message.role === 'bashExecution') return [text(message.command), text(message.output)].filter(Boolean).join('\n');
  return '';
}

function snippetFor(value: string, query: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLocaleLowerCase();
  const index = lower.indexOf(query.toLocaleLowerCase());
  if (index < 0) return normalized.slice(0, MAX_SNIPPET);
  const start = Math.max(0, index - 72);
  const end = Math.min(normalized.length, index + query.length + 120);
  return `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

export interface SearchableSession {
  taskId: string;
  title: string;
  cwd: string;
  archived: boolean;
}

export function parseSessionHistory(content: string, session: SearchableSession, query: string, limit: number): HistorySearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const results: HistorySearchResult[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (results.length >= limit) break;
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try { entry = JSON.parse(line) as Record<string, unknown>; }
    catch { continue; }
    if (entry.type !== 'message' || typeof entry.id !== 'string') continue;
    const message = record(entry.message);
    if (!message) continue;
    const role = message.role;
    if (!['user', 'assistant', 'custom', 'branchSummary', 'compactionSummary', 'bashExecution'].includes(String(role))) continue;
    const body = messageText(message);
    if (!body.toLocaleLowerCase().includes(normalizedQuery)) continue;
    const parsed = Date.parse(text(entry.timestamp));
    results.push({
      taskId: session.taskId,
      title: session.title,
      cwd: session.cwd,
      entryId: entry.id,
      role: role === 'branchSummary' || role === 'compactionSummary' ? 'summary' : role as HistorySearchResult['role'],
      snippet: snippetFor(body, query.trim()),
      timestamp: Number.isFinite(parsed) ? parsed : 0,
      archived: session.archived,
      query: query.trim(),
    });
  }
  return results;
}

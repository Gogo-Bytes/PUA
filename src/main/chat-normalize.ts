import type { ConversationBlock, ConversationImage, ConversationMessage, ConversationHistoryItem, ConversationJson, ConversationObject, ToolOutput } from '../modules/conversation/index.js';

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(item => {
    const value = object(item);
    if (!value) return '';
    if (value.type === 'text') return string(value.text) ?? '';
    return '';
  }).filter(Boolean).join('\n');
}

export function contentImages(content: unknown): ConversationImage[] {
  if (!Array.isArray(content)) return [];
  let bytes = 0;
  return content.flatMap((raw): ConversationImage[] => {
    const item = object(raw);
    if (item?.type !== 'image' || typeof item.data !== 'string' || typeof item.mimeType !== 'string') return [];
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) return [];
    if (item.data.length > 7 * 1024 * 1024 || (bytes += item.data.length) > 14 * 1024 * 1024) return [];
    return [{ type: 'image', data: item.data, mimeType: item.mimeType }];
  }).slice(0, 4);
}

function assistantBlocks(content: unknown): ConversationBlock[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): ConversationBlock[] => {
    const value = object(item);
    if (!value) return [];
    if (value.type === 'text') return [{ type: 'text', text: string(value.text) ?? '' }];
    if (value.type === 'thinking') return [{ type: 'thinking', text: string(value.thinking) ?? '' }];
    if (value.type === 'toolCall') return [{ type: 'tool', tool: {
      id: string(value.id) ?? `tool-${Math.random()}`,
      name: string(value.name) ?? 'tool',
      arguments: jsonObject(value.arguments) ?? {}, status: 'pending', output: '',
    } }];
    return [];
  });
}

export function normalizeMessage(raw: unknown, sequence: number): ConversationMessage | undefined {
  const value = object(raw);
  const role = string(value?.role);
  if (!value || !role) return;
  const timestamp = number(value.timestamp) ?? Date.now();
  const id = `${role}-${timestamp}-${sequence}`;
  if (role === 'user') return { id, role: 'user', blocks: [{ type: 'text', text: contentText(value.content) }, ...contentImages(value.content)], timestamp };
  if (role === 'assistant') return {
    id, role: 'assistant', blocks: assistantBlocks(value.content), timestamp,
    error: string(value.errorMessage), streaming: value.stopReason === 'pending',
  };
  if (role === 'custom' && value.display !== false) return { id, role: 'custom', label: string(value.customType), blocks: [{ type: 'text', text: contentText(value.content) }, ...contentImages(value.content)], timestamp };
  if (role === 'branchSummary') return { id, role: 'summary', label: '分支摘要', blocks: [{ type: 'text', text: string(value.summary) ?? '' }], timestamp };
  if (role === 'compactionSummary') return { id, role: 'summary', label: '上下文摘要', blocks: [{ type: 'text', text: string(value.summary) ?? '' }], timestamp };
  if (role === 'bashExecution') return { id, role: 'custom', label: `命令 · ${string(value.command) ?? ''}`, blocks: [{ type: 'text', text: string(value.output) ?? '' }], timestamp, error: number(value.exitCode) ? `退出码 ${value.exitCode}` : undefined };
  return;
}

/** Only structural normalization here; single-pass result association belongs to the stream core. */
export function normalizeHistoryItems(rawMessages: unknown): ConversationHistoryItem[] {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages.flatMap((raw, index): ConversationHistoryItem[] => {
    const value = object(raw);
    if (value?.role === 'toolResult') {
      return typeof value.toolCallId === 'string' ? [{ type: 'result', result: {
        toolId: value.toolCallId, failed: !!value.isError, result: normalizeToolResult(value),
      } }] : [];
    }
    const message = normalizeMessage(raw, index);
    return message ? [{ type: 'message', message }] : [];
  });
}

export function normalizeToolResult(result: unknown): ToolOutput {
  const value = object(result);
  return { output: contentText(value?.content), details: jsonValue(value?.details), images: contentImages(value?.content) };
}

export function isRecord(value: unknown): value is Record<string, unknown> { return !!object(value); }

// JSONL payload leaves are shared read-only, not cloned into a second transcript.
function isJson(value: unknown): value is ConversationJson {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    // JSON.parse can produce numeric overflow; do not narrow existing tool values.
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') continue;
    if (!Array.isArray(item) && !isRecord(item)) return false;
    if (seen.has(item)) return false;
    seen.add(item);
    for (const child of Object.values(item)) pending.push(child);
  }
  return true;
}
export function jsonValue(value: unknown): ConversationJson | undefined { return isJson(value) ? value : undefined; }
export function jsonObject(value: unknown): ConversationObject | undefined { return isRecord(value) && isJson(value) ? value as ConversationObject : undefined; }
export function decodeArguments(text: string): ConversationObject | undefined {
  try { return jsonObject(JSON.parse(text)); } catch { return undefined; }
}

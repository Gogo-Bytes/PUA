import type { ChatBlock, ChatImageBlock, ChatMessage, ToolActivity } from '../shared/chat.js';

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

export function contentImages(content: unknown): ChatImageBlock[] {
  if (!Array.isArray(content)) return [];
  let bytes = 0;
  return content.flatMap((raw): ChatImageBlock[] => {
    const item = object(raw);
    if (item?.type !== 'image' || typeof item.data !== 'string' || typeof item.mimeType !== 'string') return [];
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) return [];
    if (item.data.length > 7 * 1024 * 1024 || (bytes += item.data.length) > 14 * 1024 * 1024) return [];
    return [{ type: 'image', data: item.data, mimeType: item.mimeType }];
  }).slice(0, 4);
}

function assistantBlocks(content: unknown): ChatBlock[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): ChatBlock[] => {
    const value = object(item);
    if (!value) return [];
    if (value.type === 'text') return [{ type: 'text', text: string(value.text) ?? '' }];
    if (value.type === 'thinking') return [{ type: 'thinking', text: string(value.thinking) ?? '' }];
    if (value.type === 'toolCall') return [{ type: 'tool', tool: {
      id: string(value.id) ?? `tool-${Math.random()}`,
      name: string(value.name) ?? 'tool',
      arguments: object(value.arguments) ?? {}, status: 'pending', output: '',
    } }];
    return [];
  });
}

export function normalizeMessage(raw: unknown, sequence: number): ChatMessage | undefined {
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

export function normalizeHistory(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  const messages: ChatMessage[] = [];
  const tools = new Map<string, ToolActivity>();
  rawMessages.forEach((raw, index) => {
    const value = object(raw);
    if (value?.role === 'toolResult') {
      const id = string(value.toolCallId);
      if (id && tools.has(id)) {
        const tool = tools.get(id)!;
        tool.status = value.isError ? 'error' : 'success';
        tool.output = contentText(value.content);
        tool.details = value.details; tool.images = contentImages(value.content);
      }
      return;
    }
    const message = normalizeMessage(raw, index);
    if (!message) return;
    for (const block of message.blocks) if (block.type === 'tool') tools.set(block.tool.id, block.tool);
    messages.push(message);
  });
  return messages;
}

export function normalizeToolResult(result: unknown): { output: string; details?: unknown; images: ChatImageBlock[] } {
  const value = object(result);
  return { output: contentText(value?.content), details: value?.details, images: contentImages(value?.content) };
}

export function isRecord(value: unknown): value is Record<string, unknown> { return !!object(value); }

import type { ConversationMessage, ConversationStreamInput, ConversationStreamNotification, ToolExecution } from '../../../modules/conversation/index.js';
import type { ChatMessage, SessionEvent, ToolActivity } from '../../../shared/ipc/conversation.js';
import { validBlockIndex } from '../../../shared/ipc/conversation-validation.js';
import { isRecord, jsonObject, normalizeMessage, normalizeToolResult } from './chat-normalize.js';

/** Adapter-only identity allocator; no active message, tool or fragment state. */
export class ConversationStreamMapper {
  private sequence = 0;

  normalize(value: Record<string, unknown>): ConversationStreamInput | undefined {
    switch (value.type) {
      case 'message_start': {
        const message = normalizeMessage(value.message, this.sequence++);
        if (!message) return;
        return { type: 'message-began', message: message.role === 'assistant' ? { ...message, id: `stream-${Date.now()}-${this.sequence}` } : message };
      }
      case 'message_end': {
        const raw = isRecord(value.message) ? value.message : undefined;
        if (raw?.role === 'toolResult' && typeof raw.toolCallId === 'string') return {
          type: 'message-boundary', result: { toolId: raw.toolCallId, failed: !!raw.isError, result: normalizeToolResult(raw) },
        };
        return { type: 'message-boundary', message: normalizeMessage(value.message, this.sequence++) };
      }
      case 'message_update': {
        if (!isRecord(value.assistantMessageEvent)) return;
        const update = value.assistantMessageEvent;
        const blockIndex = update.contentIndex;
        if (!validBlockIndex(blockIndex)) return { type: 'invalid-fragment-index' };
        if ((update.type === 'text_delta' || update.type === 'thinking_delta') && typeof update.delta === 'string') return {
          type: 'fragment', blockIndex, blockType: update.type === 'text_delta' ? 'text' : 'thinking', delta: update.delta,
        };
        if (update.type === 'toolcall_start' && typeof update.id === 'string') return {
          type: 'tool-declared', blockIndex, toolId: update.id, name: typeof update.toolName === 'string' ? update.toolName : 'tool',
        };
        if (update.type === 'toolcall_delta' && typeof update.delta === 'string') return { type: 'arguments-fragment', blockIndex, delta: update.delta };
        if (update.type === 'toolcall_end' && isRecord(update.toolCall) && typeof update.toolCall.id === 'string') return {
          type: 'declaration-completed', blockIndex, toolId: update.toolCall.id,
          name: typeof update.toolCall.name === 'string' ? update.toolCall.name : undefined, arguments: jsonObject(update.toolCall.arguments),
        };
        return;
      }
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end': {
        if (typeof value.toolCallId !== 'string') return;
        const declaration = { toolId: value.toolCallId, name: typeof value.toolName === 'string' ? value.toolName : 'tool', arguments: jsonObject(value.args) };
        if (value.type === 'tool_execution_start') return { type: 'execution-began', ...declaration };
        if (value.type === 'tool_execution_update') return { type: 'execution-progressed', ...declaration, result: normalizeToolResult(value.partialResult) };
        return { type: 'execution-finished', ...declaration, result: normalizeToolResult(value.result), failed: !!value.isError };
      }
    }
  }
}

export function toolDTO(tool: ToolExecution): ToolActivity {
  return { ...tool, arguments: { ...tool.arguments }, images: tool.images?.map(image => ({ ...image })) };
}
export function messageDTO(message: ConversationMessage): ChatMessage {
  return { ...message, blocks: message.blocks.map(block => block.type === 'tool' ? { type: 'tool', tool: toolDTO(block.tool) } : { ...block }) };
}
type StreamEvent = Extract<SessionEvent, { type: 'chat-message-start' | 'chat-message-delta' | 'chat-message-end' | 'chat-tool' }>;
type WithoutId<T> = T extends { id: string } ? Omit<T, 'id'> : never;
export function streamNotificationDTO(notification: Exclude<ConversationStreamNotification, { type: 'fragment-index-rejected' }>): WithoutId<StreamEvent> {
  switch (notification.type) {
    case 'message-began': return { type: 'chat-message-start', message: messageDTO(notification.message) };
    case 'message-completed': return { type: 'chat-message-end', message: messageDTO(notification.message) };
    case 'fragment': return { ...notification, type: 'chat-message-delta' };
    case 'tool-changed': return { ...notification, type: 'chat-tool', tool: toolDTO(notification.tool) };
  }
}

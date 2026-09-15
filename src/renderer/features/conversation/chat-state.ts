import { validBlockIndex } from '../../../shared/ipc/conversation-validation';
import type { ChatCommand, ChatMessage, ChatQueue, ChatRuntimeState, ChatTreeNode, ChatWidget, ExtensionUIRequest, SessionEvent, ToolActivity } from '../../../shared/ipc/conversation';

export interface ChatNotice { id: string; level: 'info' | 'warning' | 'error'; message: string }
export interface ChatViewState extends ChatRuntimeState {
  ready: boolean;
  messages: ChatMessage[];
  commands: ChatCommand[];
  notices: ChatNotice[];
  dialog?: ExtensionUIRequest;
  dialogs: ExtensionUIRequest[];
  exited: boolean;
  sessionTree?: ChatTreeNode[];
}

export const emptyChatState = (): ChatViewState => ({ ready: false, exited: false, dialogs: [], activity: 'idle', messages: [], commands: [], queue: { steering: [], followUp: [] }, statuses: {}, widgets: [], notices: [] });

function updateMessage(messages: ChatMessage[], id: string, update: (message: ChatMessage) => ChatMessage): ChatMessage[] {
  const index = messages.findIndex(message => message.id === id);
  if (index < 0) return messages;
  const next = [...messages]; next[index] = update(messages[index]); return next;
}

function mergeTool(message: ChatMessage, tool: ToolActivity, blockIndex?: number): ChatMessage {
  if (blockIndex !== undefined && !validBlockIndex(blockIndex)) return message;
  const blocks = [...message.blocks];
  const existingIndex = blocks.findIndex(block => block.type === 'tool' && block.tool.id === tool.id);
  const index = existingIndex >= 0 ? existingIndex : blockIndex ?? blocks.length;
  while (blocks.length <= index) blocks.push({ type: 'text', text: '' });
  const previous = blocks[index];
  if (message.streaming === false) {
    if (previous?.type !== 'tool' || previous.tool.id !== tool.id) return message;
    tool = { ...tool, name: previous.tool.name, arguments: previous.tool.arguments };
  }
  if (previous?.type === 'tool' && previous.tool.id === tool.id && ['success', 'error'].includes(previous.tool.status) && ['pending', 'running'].includes(tool.status)) return message;
  blocks[index] = { type: 'tool', tool };
  return { ...message, blocks };
}

export function reduceChatEvent(state: ChatViewState, event: SessionEvent): ChatViewState {
  switch (event.type) {
    case 'chat-snapshot': return { ...state, ...event.snapshot, ready: true, notices: state.notices };
    case 'chat-message-start': {
      const messages = state.messages.some(message => message.id === event.message.id) ? state.messages : [...state.messages, event.message];
      return { ...state, messages };
    }
    case 'chat-message-delta': if (!validBlockIndex(event.blockIndex)) return state; return { ...state, messages: updateMessage(state.messages, event.messageId, message => {
      const blocks = [...message.blocks];
      while (blocks.length <= event.blockIndex) blocks.push({ type: event.blockType, text: '' });
      const current = blocks[event.blockIndex];
      blocks[event.blockIndex] = current.type === event.blockType ? { ...current, text: current.text + event.delta } : { type: event.blockType, text: event.delta };
      return { ...message, blocks, streaming: true };
    }) };
    case 'chat-message-end': {
      const message = { ...event.message, streaming: false };
      const index = state.messages.findIndex(item => item.id === message.id);
      return { ...state, messages: index < 0 ? [...state.messages, message] : state.messages.map(item => item.id === message.id ? message : item) };
    }
    case 'chat-tool': {
      let applied = false;
      const messages = state.messages.map(message => {
        const owns = message.id === event.messageId || message.blocks.some(block => block.type === 'tool' && block.tool.id === event.tool.id);
        if (!owns) return message; applied = true; return mergeTool(message, event.tool, event.blockIndex);
      });
      if (!applied && event.messageId) {
        const placeholder: ChatMessage = { id: event.messageId, role: 'assistant', blocks: [], timestamp: Date.now(), streaming: true };
        messages.push(mergeTool(placeholder, event.tool, event.blockIndex));
      }
      return { ...state, messages };
    }
    case 'chat-state': return { ...state, ...event.state };
    case 'extension-ui': { const dialogs = [...state.dialogs, event.request]; return { ...state, dialogs, dialog: dialogs[0] }; }
    case 'extension-ui-closed': { const dialogs = state.dialogs.filter(request => request.id !== event.requestId); return { ...state, dialogs, dialog: dialogs[0] }; }
    case 'chat-notice': return { ...state, notices: [...state.notices.slice(-19), { id: `${Date.now()}-${state.notices.length}`, level: event.level, message: event.message }] };
    case 'exit': return { ...state, exited: true, activity: 'idle', dialog: undefined, dialogs: [], queue: { steering: [], followUp: [] } };
    default: return state;
  }
}

export function queueText(queue: ChatQueue): string[] { return [...queue.steering, ...queue.followUp]; }
export function widgetsAt(widgets: ChatWidget[], placement: ChatWidget['placement']): ChatWidget[] { return widgets.filter(widget => widget.placement === placement); }

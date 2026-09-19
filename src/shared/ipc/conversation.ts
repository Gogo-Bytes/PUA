export type SessionKind = 'chat' | 'terminal';
export type SessionProcessStatus = 'starting' | 'running' | 'exited';
export type SessionActivity = 'idle' | 'responding' | 'compacting' | 'retrying' | 'waiting-input';
export type ChatDelivery = 'prompt' | 'steer' | 'followUp';
export type ProjectTrust = 'default' | 'approve' | 'decline';

export interface ChatTextBlock { type: 'text'; text: string }
export interface ChatThinkingBlock { type: 'thinking'; text: string }
export interface ChatImageBlock { type: 'image'; mimeType: string; data: string }
export interface ToolActivity {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  output: string;
  details?: unknown;
  images?: ChatImageBlock[];
}
export interface ChatToolBlock { type: 'tool'; tool: ToolActivity }
export type ChatBlock = ChatTextBlock | ChatThinkingBlock | ChatToolBlock | ChatImageBlock;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'custom' | 'summary';
  blocks: ChatBlock[];
  timestamp: number;
  streaming?: boolean;
  error?: string;
  label?: string;
  /** Pi JSONL entry identity used by the message-level fork action. */
  forkEntryId?: string;
}

export interface ChatCommand {
  name: string;
  description?: string;
  source: 'extension' | 'prompt' | 'skill';
}

export interface ChatQueue { steering: string[]; followUp: string[] }
export interface ChatWidget { key: string; lines: string[]; placement: 'aboveEditor' | 'belowEditor' }
export interface ChatRuntimeState {
  activity: SessionActivity;
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  queue: ChatQueue;
  statuses: Record<string, string>;
  widgets: ChatWidget[];
}
export interface ChatModel { provider: string; id: string; name?: string; reasoning?: boolean }
/** Pi's native per-session counters, reduced to the fields useful to the desktop UI. */
export interface ChatSessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}
export interface ChatSnapshot extends ChatRuntimeState {
  messages: ChatMessage[];
  commands: ChatCommand[];
  sessionTree?: ChatTreeNode[];
}
export interface ChatTreeNode {
  entryId: string;
  label?: string;
  /** Pi's native fork command accepts user message entries only. */
  forkable?: boolean;
  /** Pi's current leaf entry; only one node in a tree can be active. */
  active?: boolean;
  children: ChatTreeNode[];
}

export type ExtensionUIRequest = ({ expiresAt?: number } & (
  | { id: string; method: 'select'; title: string; options: string[] }
  | { id: string; method: 'confirm'; title: string; message: string }
  | { id: string; method: 'input'; title: string; placeholder?: string }
  | { id: string; method: 'editor'; title: string; prefill?: string }));

export type ExtensionUIResponse =
  | { id: string; value: string }
  | { id: string; confirmed: boolean }
  | { id: string; cancelled: true };

export interface ChatAttachment {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'image';
  mimeType?: string;
  size: number;
  previewUrl?: string;
}

export type SessionEvent =
  | { type: 'terminal-data'; id: string; data: string }
  | { type: 'chat-snapshot'; id: string; snapshot: ChatSnapshot }
  | { type: 'chat-fork-metadata'; id: string; entries: { entryId: string; text: string }[]; sessionTree: ChatTreeNode[] }
  | { type: 'chat-message-start'; id: string; message: ChatMessage }
  | { type: 'chat-message-delta'; id: string; messageId: string; blockIndex: number; blockType: 'text' | 'thinking'; delta: string }
  | { type: 'chat-message-end'; id: string; message: ChatMessage }
  | { type: 'chat-tool'; id: string; messageId?: string; blockIndex?: number; tool: ToolActivity }
  | { type: 'chat-state'; id: string; state: Partial<ChatRuntimeState> }
  | { type: 'extension-ui-closed'; id: string; requestId: string }
  | { type: 'extension-ui'; id: string; request: ExtensionUIRequest }
  | { type: 'chat-notice'; id: string; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'chat-queue-recovered'; id: string; requestId: string; queue: ChatQueue }
  | { type: 'chat-editor-text'; id: string; text: string }
  | { type: 'session-info'; id: string; title?: string; processStatus?: SessionProcessStatus; activity?: SessionActivity }
  | { type: 'exit'; id: string; exitCode: number };

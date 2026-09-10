/** JSON leaves are immutable tool data, never a protocol command/envelope. */
export type ConversationJson = null | boolean | number | string | readonly ConversationJson[] | ConversationObject;
export interface ConversationObject { readonly [key: string]: ConversationJson }
export interface ConversationImage { readonly type: 'image'; readonly data: string; readonly mimeType: string }
export interface ToolOutput { readonly output: string; readonly details?: ConversationJson; readonly images: readonly ConversationImage[] }
export interface ToolExecution {
  readonly id: string;
  readonly name: string;
  readonly arguments: ConversationObject;
  readonly status: 'pending' | 'running' | 'success' | 'error';
  readonly output: string;
  readonly details?: ConversationJson;
  readonly images?: readonly ConversationImage[];
}
export type ConversationBlock = { readonly type: 'text' | 'thinking'; readonly text: string }
  | ConversationImage | { readonly type: 'tool'; readonly tool: ToolExecution };
export interface ConversationMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'custom' | 'summary';
  readonly blocks: readonly ConversationBlock[];
  readonly timestamp: number;
  readonly label?: string;
  readonly error?: string;
  readonly streaming?: boolean;
}
export interface ConversationToolResult { readonly toolId: string; readonly failed: boolean; readonly result: ToolOutput }
export type ConversationHistoryItem = { readonly type: 'message'; readonly message: ConversationMessage }
  | { readonly type: 'result'; readonly result: ConversationToolResult };
export type ConversationStreamInput =
  | { readonly type: 'invalid-fragment-index' }
  | { readonly type: 'message-began'; readonly message: ConversationMessage }
  | { readonly type: 'fragment'; readonly blockIndex: number; readonly blockType: 'text' | 'thinking'; readonly delta: string }
  | { readonly type: 'tool-declared'; readonly blockIndex: number; readonly toolId: string; readonly name: string }
  | { readonly type: 'arguments-fragment'; readonly blockIndex: number; readonly delta: string }
  | { readonly type: 'declaration-completed'; readonly blockIndex: number; readonly toolId: string; readonly name?: string; readonly arguments?: ConversationObject }
  // Even an unrecognized end is a flush boundary.
  | { readonly type: 'message-boundary'; readonly message?: ConversationMessage; readonly result?: never }
  | { readonly type: 'message-boundary'; readonly result: ConversationToolResult; readonly message?: never }
  | { readonly type: 'execution-began'; readonly toolId: string; readonly name: string; readonly arguments?: ConversationObject }
  | { readonly type: 'execution-progressed'; readonly toolId: string; readonly name: string; readonly arguments?: ConversationObject; readonly result: ToolOutput }
  | { readonly type: 'execution-finished'; readonly toolId: string; readonly name: string; readonly arguments?: ConversationObject; readonly result: ToolOutput; readonly failed: boolean };
export type ConversationStreamNotification =
  | { readonly type: 'fragment-index-rejected' }
  | { readonly type: 'message-began' | 'message-completed'; readonly message: ConversationMessage }
  | { readonly type: 'fragment'; readonly messageId: string; readonly blockIndex: number; readonly blockType: 'text' | 'thinking'; readonly delta: string }
  | { readonly type: 'tool-changed'; readonly messageId?: string; readonly blockIndex?: number; readonly tool: ToolExecution };

/** Shared by historical and live results: each complete result replaces, including empty values. */
export function completedTool(tool: ToolExecution, result: ConversationToolResult): ToolExecution {
  return { ...tool, ...result.result, status: result.failed ? 'error' : 'success' };
}

import type { DesktopResult, WireValue } from './desktop-result.js';
import type { DiffScope, FileDiff, GitStatus } from './change-review.js';
import type {
  ChatAttachment, ChatCommand, ChatDelivery, ExtensionUIResponse, ProjectTrust, SessionActivity,
  SessionEvent, SessionKind, SessionProcessStatus,
} from './conversation.js';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Preferences {
  /** Omitted by older desktop clients; normalized to system on save/read. */
  theme?: ThemePreference;
  piPath: string;
  nodePath: string;
  args: string[];
  fontSize: number;
  recentProjects: string[];
}

export interface RuntimeInfo {
  executable: string;
  args: string[];
  source: string;
}

export interface Bootstrap {
  preferences: Preferences;
  runtime: RuntimeInfo | null;
  runtimeError?: string;
  home: string;
  platform: string;
  restoredSessions?: SessionInfo[];
  archivedSessions?: SessionInfo[];
}

export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  kind: SessionKind;
  processStatus: SessionProcessStatus;
  activity: SessionActivity;
  exitCode?: number;
  archived?: boolean;
  pinned?: boolean;
  lastActivityAt?: number;
}

export interface HistorySearchOptions {
  query: string;
  limit?: number;
}

/** Safe projection of a Pi JSONL entry; the session path and raw payload never cross IPC. */
export interface HistorySearchResult {
  taskId: string;
  title: string;
  cwd: string;
  entryId: string;
  role: 'user' | 'assistant' | 'custom' | 'summary' | 'bashExecution';
  snippet: string;
  timestamp: number;
  archived: boolean;
  query: string;
}

export type ChatQueueMode = 'all' | 'one-at-a-time';
export interface ChatAutoSettings { autoCompaction: boolean; autoRetry: boolean; steeringMode?: ChatQueueMode; followUpMode?: ChatQueueMode }

export interface CreateSessionOptions {
  cwd: string;
  kind: SessionKind;
  startMode: 'new' | 'continue' | 'resume';
  projectTrust: ProjectTrust;
  /** Applied only to a newly-created Chat process; omitted preserves Pi's configured default. */
  initialModel?: { provider: string; id: string };
  /** Pi CLI thinking preset; omitted preserves Pi's configured default. */
  initialThinkingLevel?: PiThinkingLevel;
  cols?: number;
  rows?: number;
}

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProjectResourceInfo { hasResources: boolean; paths: string[]; skills?: ChatCommand[]; prompts?: ChatCommand[] }

export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  chooseDirectory(): Promise<string | null>;
  chooseFile(): Promise<string | null>;
  chooseAttachments(): Promise<string[]>;
  removeChatAttachment(id: string, attachmentId: string): Promise<void>;
  /** With paths, register a pre-session draft's staged files after its Pi session exists. */
  chooseChatAttachments(sessionId: string, paths?: string[]): Promise<ChatAttachment[]>;
  savePreferences(preferences: Preferences): Promise<Bootstrap>;
  inspectProjectResources(cwd: string): Promise<ProjectResourceInfo>;
  createSession(options: CreateSessionOptions): Promise<SessionInfo>;
  startSession(id: string): Promise<void>;
  closeSession(id: string): Promise<boolean>;
  restoreArchivedSession(id: string): Promise<SessionInfo>;
  deleteArchivedSession(id: string): Promise<void>;
  setSessionPinned(id: string, pinned: boolean): Promise<void>;
  searchHistory(options: HistorySearchOptions): Promise<HistorySearchResult[]>;
  sendChatMessage(id: string, input: { text: string; attachmentIds: string[]; delivery: ChatDelivery }): Promise<void>;
  stopChat(id: string): Promise<void>;
  respondToExtensionUI(id: string, response: ExtensionUIResponse): Promise<void>;
  renameChatSession(id: string, name: string): Promise<void>;
  forkChatSession(id: string, entryId: string): Promise<{ text: string; cancelled: boolean }>;
  cloneChatSession(id: string): Promise<SessionInfo>;
  getChatAvailableModels(id: string): Promise<import('./conversation.js').ChatModel[]>;
  /** Read Pi's model catalog without creating or restoring a Chat session. */
  getChatModelCatalog(): Promise<import('./conversation.js').ChatModel[]>;
  getChatThinkingLevels(id: string): Promise<string[]>;
  setChatModel(id: string, provider: string, modelId: string): Promise<void>;
  setChatThinkingLevel(id: string, level: string): Promise<void>;
  getChatSessionStats(id: string): Promise<import('./conversation.js').ChatSessionStats>;
  getChatAutoSettings(id: string): Promise<ChatAutoSettings>;
  setChatSteeringMode(id: string, mode: ChatQueueMode): Promise<void>;
  setChatFollowUpMode(id: string, mode: ChatQueueMode): Promise<void>;
  compactChatSession(id: string, customInstructions?: string): Promise<void>;
  setChatAutoCompaction(id: string, enabled: boolean): Promise<void>;
  setChatAutoRetry(id: string, enabled: boolean): Promise<void>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  acknowledge(id: string, size: number): void;
  onSessionEvent(callback: (event: SessionEvent) => void): () => void;
  openExternal(url: string): Promise<void>;
  openProject(id: string): Promise<void>;
  gitStatus(id: string): Promise<GitStatus>;
  fileDiff(id: string, path: string, scope: DiffScope): Promise<FileDiff>;
  readClipboard(): Promise<{ text: string; image: boolean }>;
  writeClipboard(text: string): Promise<void>;
}

/** Raw sandbox transport. Application callers use DesktopAPI through the renderer client. */
export type DesktopBridge = {
  [K in keyof DesktopAPI]: K extends 'onSessionEvent'
    ? (callback: (event: unknown) => void) => () => void
    : ReturnType<DesktopAPI[K]> extends Promise<infer T>
      ? (...args: Parameters<DesktopAPI[K]>) => Promise<DesktopResult<WireValue<T>>>
      : DesktopAPI[K];
};

declare global {
  interface Window { desktop?: DesktopBridge }
}

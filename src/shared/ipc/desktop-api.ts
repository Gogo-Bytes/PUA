import type { DiffScope, FileDiff, GitStatus } from '../git.js';
import type {
  ChatAttachment, ChatDelivery, ExtensionUIResponse, ProjectTrust, SessionActivity,
  SessionEvent, SessionKind, SessionProcessStatus,
} from '../chat.js';

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
}

export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  kind: SessionKind;
  processStatus: SessionProcessStatus;
  activity: SessionActivity;
  exitCode?: number;
}

export interface CreateSessionOptions {
  cwd: string;
  kind: SessionKind;
  startMode: 'new' | 'continue' | 'resume';
  projectTrust: ProjectTrust;
  cols?: number;
  rows?: number;
}

export interface ProjectResourceInfo { hasResources: boolean; paths: string[] }

export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  chooseDirectory(): Promise<string | null>;
  chooseFile(): Promise<string | null>;
  chooseAttachments(): Promise<string[]>;
  removeChatAttachment(id: string, attachmentId: string): Promise<void>;
  chooseChatAttachments(sessionId: string): Promise<ChatAttachment[]>;
  savePreferences(preferences: Preferences): Promise<Bootstrap>;
  inspectProjectResources(cwd: string): Promise<ProjectResourceInfo>;
  createSession(options: CreateSessionOptions): Promise<SessionInfo>;
  startSession(id: string): Promise<void>;
  closeSession(id: string): Promise<boolean>;
  sendChatMessage(id: string, input: { text: string; attachmentIds: string[]; delivery: ChatDelivery }): Promise<void>;
  stopChat(id: string): Promise<void>;
  respondToExtensionUI(id: string, response: ExtensionUIResponse): Promise<void>;
  renameChatSession(id: string, name: string): Promise<void>;
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

declare global {
  interface Window { desktop: DesktopAPI }
}

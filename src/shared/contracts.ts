export interface Preferences {
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
  status: 'running' | 'exited';
  exitCode?: number;
}

export type TerminalEvent =
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number };

export interface DesktopAPI {
  bootstrap(): Promise<Bootstrap>;
  chooseDirectory(): Promise<string | null>;
  chooseFile(): Promise<string | null>;
  chooseAttachments(): Promise<string[]>;
  savePreferences(preferences: Preferences): Promise<Bootstrap>;
  createSession(options: { cwd: string; mode: 'new' | 'continue' | 'resume'; cols: number; rows: number }): Promise<SessionInfo>;
  startSession(id: string): Promise<void>;
  closeSession(id: string): Promise<boolean>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  acknowledge(id: string, size: number): void;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  openExternal(url: string): Promise<void>;
  openProject(id: string): Promise<void>;
  readClipboard(): Promise<{ text: string; image: boolean }>;
  writeClipboard(text: string): Promise<void>;
}

declare global {
  interface Window { desktop: DesktopAPI }
}

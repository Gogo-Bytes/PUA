/** Internal Pi identity shared by the main/worker transport seam; never exposed to renderer IPC. */
export interface NativePiSessionIdentity {
  sessionId: string;
  sessionFile: string;
}

export interface ChatSessionIdentity {
  piSessionId: string;
  mode: 'create' | 'restore';
  sessionFile?: string;
}

/** Application failure carrier; Electron IPC maps it to the desktop wire contract. */
export class DesktopApplicationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

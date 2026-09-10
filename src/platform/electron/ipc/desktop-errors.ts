import { safeErrorMessage, type DesktopError } from '../../../shared/ipc/desktop-result.js';

/** Edge-only code carrier; domain results and successful application values stay wire-free. */
export class DesktopApplicationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export class DesktopAuthorizationError extends Error {
  constructor() { super('Untrusted IPC sender'); }
}

export function desktopFailure(error: unknown, validation = false): { ok: false; error: DesktopError } {
  const fallback = '桌面操作失败';
  const message = safeErrorMessage(error);
  try {
    if (message === undefined) return { ok: false, error: { kind: 'internal', code: 'INTERNAL_FAILURE', message: fallback } };
    if (error instanceof DesktopAuthorizationError) return { ok: false, error: { kind: 'authorization', code: 'UNTRUSTED_SENDER', message } };
    if (validation) return { ok: false, error: { kind: 'validation', code: 'INVALID_ARGUMENTS', message } };
    if (error instanceof DesktopApplicationError) {
      const code = error.code;
      if (typeof code === 'string' && code.length > 0) return { ok: false, error: { kind: 'application', code, message } };
    }
    if (error instanceof Error) return { ok: false, error: { kind: 'application', code: 'APPLICATION_FAILED', message } };
  } catch { /* Unknown or unreadable failures carry no host values. */ }
  return { ok: false, error: { kind: 'internal', code: 'INTERNAL_FAILURE', message: fallback } };
}

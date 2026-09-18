export type SessionKind = 'chat' | 'terminal';
export type SessionStartMode = 'new' | 'continue' | 'resume';
export type LiveStatus = 'starting' | 'running';
export type SessionLifecycle =
  | { phase: 'reserved' | 'starting' | 'running' }
  | { phase: 'closing' | 'cleanup-failed'; previous: LiveStatus }
  | { phase: 'exited'; exitCode: number };
export interface SessionIntent { kind: SessionKind; startMode: SessionStartMode }
export interface PreparedSession extends SessionIntent { id: string; cwd: string; title: string; dormant?: boolean }
export interface SessionSnapshot extends PreparedSession { lifecycle: SessionLifecycle }
export type SessionFailureCode = 'SHUTTING_DOWN' | 'CHAT_RESUME_UNSUPPORTED' | 'TERMINAL_EXCLUSIVE' | 'RESTORE_CONFLICT' | 'SESSION_NOT_FOUND' | 'SESSION_NOT_STARTABLE' | 'PROCESS_START_FAILED' | 'CLEANUP_FAILED';
export type SessionResult<T = void> = { ok: true; value: T } | { ok: false; code: SessionFailureCode; detail?: string };
const allowed: SessionResult = { ok: true, value: undefined };

export function processStatus(lifecycle: SessionLifecycle): LiveStatus | 'exited' {
  switch (lifecycle.phase) {
    case 'reserved': case 'starting': return 'starting';
    case 'closing': case 'cleanup-failed': return lifecycle.previous;
    default: return lifecycle.phase;
  }
}

/** The sole ownership policy: slots include reservations and unconfirmed cleanup, across all cwd values. */
export const SessionOwnershipPolicy = {
  intent(intent: SessionIntent): SessionResult {
    return intent.kind === 'chat' && intent.startMode === 'resume'
      ? { ok: false, code: 'CHAT_RESUME_UNSUPPORTED' } : allowed;
  },
  reserve(intent: SessionIntent, sessions: readonly SessionSnapshot[], shuttingDown: boolean): SessionResult {
    if (shuttingDown) return { ok: false, code: 'SHUTTING_DOWN' };
    const valid = this.intent(intent); if (!valid.ok) return valid;
    const live = sessions.filter(session => session.lifecycle.phase !== 'exited' && !session.dormant);
    if (live.length && (intent.kind === 'terminal' || live.some(session => session.kind === 'terminal'))) return { ok: false, code: 'TERMINAL_EXCLUSIVE' };
    if ((intent.startMode !== 'new' && live.length) || live.some(session => session.startMode === 'continue' && processStatus(session.lifecycle) === 'starting')) return { ok: false, code: 'RESTORE_CONFLICT' };
    return allowed;
  },
};

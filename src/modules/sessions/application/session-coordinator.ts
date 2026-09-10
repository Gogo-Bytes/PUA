import { SessionOwnershipPolicy, processStatus, type PreparedSession, type SessionIntent, type SessionResult, type SessionSnapshot } from '../domain/session-ownership.js';
import type { SessionProcessEvent, SessionProcessPort } from '../ports.js';

export type SessionChange =
  | { type: 'changed' | 'exited'; session: SessionSnapshot }
  | { type: 'removed'; id: string }
  | { type: 'failed'; id: string; code: 'PROCESS_START_FAILED' | 'CLEANUP_FAILED'; detail: string };
interface Entry { session: SessionSnapshot; closing?: Promise<SessionResult>; removeWhenClosed: boolean }
const success: SessionResult = { ok: true, value: undefined };

/** Owns admission and lifecycle, never transport, activity, or platform resources.
 * create reserves synchronously; close locks synchronously and shares a sticky cleanup result. */
export class SessionCoordinator {
  private readonly entries = new Map<string, Entry>();
  private shuttingDown = false;
  constructor(private readonly transport: SessionProcessPort, private readonly observer: (event: SessionChange) => void = () => {}) {
    transport.observe(event => this.onProcessEvent(event));
  }
  checkAdmission(): SessionResult { return this.shuttingDown ? { ok: false, code: 'SHUTTING_DOWN' } : success; }
  checkIntent(intent: SessionIntent): SessionResult { return SessionOwnershipPolicy.intent(intent); }
  create(command: PreparedSession): SessionResult<SessionSnapshot> {
    const allowed = SessionOwnershipPolicy.reserve(command, this.list(), this.shuttingDown);
    if (!allowed.ok) return allowed;
    if (this.entries.has(command.id)) return { ok: false, code: 'SESSION_NOT_STARTABLE', detail: 'Duplicate session ID' };
    const session: SessionSnapshot = { ...command, lifecycle: { phase: 'reserved' } };
    this.entries.set(command.id, { session, removeWhenClosed: false });
    // No observer call here: composition must register start materials before external reentry.
    return { ok: true, value: this.snapshot(session) };
  }
  get(id: string): SessionSnapshot | undefined { const entry = this.entries.get(id); return entry && this.snapshot(entry.session); }
  list(): SessionSnapshot[] { return [...this.entries.values()].map(entry => this.snapshot(entry.session)); }
  start(id: string): SessionResult {
    const admitted = this.checkAdmission(); if (!admitted.ok) return admitted;
    const entry = this.entries.get(id); if (!entry) return { ok: false, code: 'SESSION_NOT_FOUND' };
    if (entry.session.lifecycle.phase !== 'reserved') return { ok: false, code: 'SESSION_NOT_STARTABLE' };
    entry.session.lifecycle = { phase: 'starting' };
    try {
      const started = this.transport.start(id);
      if (started) void started.catch(error => this.startFailed(entry, String(error)));
      return success;
    } catch (error) {
      this.startFailed(entry, String(error));
      return { ok: false, code: 'PROCESS_START_FAILED', detail: String(error) };
    }
  }
  close(id: string): Promise<SessionResult> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.resolve({ ok: false, code: 'SESSION_NOT_FOUND' });
    entry.removeWhenClosed = true;
    if (entry.session.lifecycle.phase === 'exited') {
      this.remove(entry);
      return entry.closing ?? Promise.resolve(success);
    }
    return this.cleanup(entry);
  }
  async closeAll(): Promise<SessionResult> {
    this.shuttingDown = true;
    const results = await Promise.all([...this.entries.keys()].map(id => this.close(id)));
    return results.find(result => !result.ok) ?? success;
  }
  private cleanup(entry: Entry): Promise<SessionResult> {
    if (entry.closing) return entry.closing;
    const previous = processStatus(entry.session.lifecycle);
    if (previous === 'exited') return Promise.resolve(success);
    entry.session.lifecycle = { phase: 'closing', previous };
    let finish!: (result: SessionResult) => void;
    entry.closing = new Promise(resolve => { finish = resolve; });
    // Install the shared work before calling the Port: close can synchronously emit/reenter.
    const completed = (exitCode: number) => {
      entry.session.lifecycle = { phase: 'exited', exitCode };
      this.notify({ type: 'exited', session: this.snapshot(entry.session) });
      if (entry.removeWhenClosed && this.entries.get(entry.session.id) === entry) this.remove(entry);
      finish(success);
    };
    const failed = (error: unknown) => {
      entry.session.lifecycle = { phase: 'cleanup-failed', previous };
      const detail = String(error);
      this.notify({ type: 'failed', id: entry.session.id, code: 'CLEANUP_FAILED', detail });
      finish({ ok: false, code: 'CLEANUP_FAILED', detail });
    };
    try { void this.transport.close(entry.session.id).then(result => completed(result.exitCode), failed); }
    catch (error) { failed(error); }
    return entry.closing;
  }
  private startFailed(entry: Entry, detail: string): void {
    if (this.entries.get(entry.session.id) !== entry || !['starting', 'running'].includes(entry.session.lifecycle.phase)) return;
    // Lock before reporting failure; an observer may call start/close/create.
    void this.cleanup(entry);
    this.notify({ type: 'failed', id: entry.session.id, code: 'PROCESS_START_FAILED', detail });
  }
  private onProcessEvent(event: SessionProcessEvent): void {
    const entry = this.entries.get(event.id); if (!entry) return;
    if (event.type === 'transport-ended') {
      if (entry.session.lifecycle.phase !== 'exited') void this.cleanup(entry);
    } else if (event.type === 'start-failed') this.startFailed(entry, event.detail);
    else if (event.type === 'ready' && entry.session.lifecycle.phase === 'starting') {
      entry.session.lifecycle = { phase: 'running' };
      this.notify({ type: 'changed', session: this.snapshot(entry.session) });
    } else if (event.type === 'title-changed' && ['reserved', 'starting', 'running'].includes(entry.session.lifecycle.phase)) {
      entry.session.title = event.title;
      this.notify({ type: 'changed', session: this.snapshot(entry.session) });
    }
  }
  private remove(entry: Entry): void { this.entries.delete(entry.session.id); this.notify({ type: 'removed', id: entry.session.id }); }
  private snapshot(session: SessionSnapshot): SessionSnapshot { return { ...session, lifecycle: { ...session.lifecycle } }; }
  private notify(event: SessionChange): void {
    // Observers are projections, not participants in resource cleanup.
    try { this.observer(event); } catch { /* Caller notification cannot retain or release ownership. */ }
  }
}

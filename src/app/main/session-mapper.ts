import { DesktopApplicationError } from './application-error.js';
import { processStatus, type SessionFailureCode, type SessionResult, type SessionSnapshot, type SessionChange } from '../../modules/sessions/index.js';
import type { SessionActivity, SessionEvent } from '../../shared/chat.js';
import type { SessionInfo } from '../../shared/ipc/desktop-api.js';

const messages: Record<SessionFailureCode, string> = {
  SHUTTING_DOWN: '应用正在关闭，不能创建会话',
  CHAT_RESUME_UNSUPPORTED: '任意历史选择首期仅支持兼容终端',
  TERMINAL_EXCLUSIVE: '兼容终端可在内部恢复任意历史，请先关闭其他会话；终端运行或关闭期间不能创建其他会话',
  RESTORE_CONFLICT: '为避免两个进程写入同一 Pi 历史，会话恢复只能在关闭其他运行会话后开始；恢复就绪前不能创建新会话',
  SESSION_NOT_FOUND: '会话不存在',
  SESSION_NOT_STARTABLE: '会话不能再次启动',
  PROCESS_START_FAILED: 'Pi 进程启动失败',
  CLEANUP_FAILED: '进程清理失败，仍保留会话占用',
};
export function unwrapSessionResult<T>(result: SessionResult<T>): T {
  if (!result.ok) throw new DesktopApplicationError(result.code, `${messages[result.code]}${result.detail ? `：${result.detail}` : ''}`);
  return result.value;
}

export function applySessionStartResult(result: SessionResult): void {
  if (!result.ok && result.code === 'SESSION_NOT_STARTABLE') return;
  if (!result.ok && result.code === 'SHUTTING_DOWN') throw new DesktopApplicationError(result.code, '应用正在关闭，不能启动会话');
  unwrapSessionResult(result);
}
export function requireSessionSnapshot(snapshot: SessionSnapshot | undefined): SessionSnapshot {
  if (!snapshot) throw new DesktopApplicationError('SESSION_NOT_FOUND', messages.SESSION_NOT_FOUND);
  return snapshot;
}
export function sessionInfo(session: SessionSnapshot, activity: SessionActivity): SessionInfo {
  const status = processStatus(session.lifecycle);
  return { id: session.id, cwd: session.cwd, title: session.title, kind: session.kind, processStatus: status, activity: status === 'exited' ? 'idle' : activity, ...(session.lifecycle.phase === 'exited' ? { exitCode: session.lifecycle.exitCode } : {}) };
}
export function isSessionBusy(session: SessionSnapshot, activity: SessionActivity): boolean {
  return session.kind === 'terminal' ? processStatus(session.lifecycle) === 'running' : processStatus(session.lifecycle) !== 'exited' && activity !== 'idle';
}
export function sessionChangeEvent(event: SessionChange): SessionEvent | undefined {
  if (event.type === 'failed') return { type: 'chat-notice', id: event.id, level: 'error', message: `${messages[event.code]}：${event.detail}` };
  if (event.type === 'exited' && event.session.lifecycle.phase === 'exited') return { type: 'exit', id: event.session.id, exitCode: event.session.lifecycle.exitCode };
  if (event.type === 'changed') return { type: 'session-info', id: event.session.id, title: event.session.title, processStatus: processStatus(event.session.lifecycle) };
}

import type { SessionInfo } from '../../../shared/ipc/desktop-api';

/**
 * Project-local collaboration is limited to Pi chat sessions PUA itself owns.
 * We do not infer participants from parallel tools, retries, or terminal work.
 */
export function activeProjectCollaborationSessions(sessions: readonly SessionInfo[], current?: SessionInfo): SessionInfo[] {
  if (!current) return [];
  return sessions.filter(session =>
    session.id !== current.id &&
    session.kind === 'chat' &&
    session.cwd === current.cwd &&
    session.processStatus !== 'exited' &&
    session.activity !== 'idle',
  );
}

export function collaborationActivityLabel(activity: SessionInfo['activity']): string {
  switch (activity) {
    case 'waiting-input': return '等待输入';
    case 'compacting': return '整理上下文';
    case 'retrying': return '重试中';
    case 'responding': return '运行中';
    case 'idle': return '就绪';
  }
}

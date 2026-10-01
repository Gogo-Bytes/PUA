import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../src/shared/ipc/desktop-api';
import { activeProjectCollaborationSessions, collaborationActivityLabel } from '../src/renderer/features/workspace/collaboration';

const session = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: 'current', cwd: '/repo', title: '当前会话', kind: 'chat', processStatus: 'running', activity: 'responding', ...overrides,
});

describe('workspace collaboration projection', () => {
  it('only shows other active Pi chat sessions in the same project', () => {
    const current = session();
    const peer = session({ id: 'peer', title: '并行会话', activity: 'waiting-input' });
    expect(activeProjectCollaborationSessions([
      current,
      peer,
      session({ id: 'idle', activity: 'idle' }),
      session({ id: 'terminal', kind: 'terminal' }),
      session({ id: 'other-project', cwd: '/other' }),
      session({ id: 'exited', processStatus: 'exited' }),
    ], current)).toEqual([peer]);
  });

  it('keeps Pi activity labels generic', () => {
    expect(collaborationActivityLabel('responding')).toBe('运行中');
    expect(collaborationActivityLabel('waiting-input')).toBe('等待输入');
  });
});

/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../../component-preview/test-setup';
import type { SessionInfo } from '../../../../src/shared/ipc/desktop-api';
import { SidePanelHost, useSidePanelTabs } from '../../../../src/renderer/features/workspace';
import { UIProvider } from '../../../../src/renderer/ui';

const task = (kind: SessionInfo['kind']): SessionInfo => ({ id: `task-${kind}`, cwd: '/work', title: '工作', kind, processStatus: 'running', activity: 'idle' });
function Harness({ kind }: { kind: SessionInfo['kind'] }) {
  const taskInfo = task(kind); const panels = useSidePanelTabs(taskInfo.id);
  return <UIProvider><button onClick={() => panels.open('terminal')}>open terminal panel</button><SidePanelHost task={taskInfo} runtime={null} panels={panels} changes={null} onClose={vi.fn()} onOpenProject={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()}/></UIProvider>;
}

it('docks the existing Terminal session in the tab and explains when the active task is not a terminal', () => {
  const { rerender } = render(<Harness kind="terminal"/>);
  fireEvent.click(screen.getByRole('button', { name: 'open terminal panel' }));
  expect(document.querySelector('.workspace-terminal-dock')).toBeTruthy();
  rerender(<Harness kind="chat"/>);
  fireEvent.click(screen.getByRole('button', { name: 'open terminal panel' }));
  expect(document.querySelector('.workspace-terminal-dock')).toBeNull();
  expect(screen.getByText(/唯一 PTY/)).toBeTruthy();
});

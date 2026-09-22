/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import '../../../component-preview/test-setup';
import { TaskDetailsPanel, useSidePanelTabs } from '../../../../src/renderer/features/workspace';
import { SidePanelHost } from '../../../../src/renderer/features/workspace';
import { UIProvider } from '../../../../src/renderer/ui';

it('shows only the task projection and keeps Pi-specific controls in their native area', () => {
  const open = vi.fn(), rename = vi.fn(), archive = vi.fn(), pin = vi.fn();
  render(<UIProvider><TaskDetailsPanel task={{ id: 's1', cwd: '/work/pua', title: '调查', kind: 'chat', processStatus: 'running', activity: 'waiting-input', pinned: false, lastActivityAt: 1 }} runtime={{ executable: '/usr/local/bin/pi', args: [], source: 'configured' }} onOpenProject={open} onRename={rename} onArchive={archive} onTogglePinned={pin}/></UIProvider>);
  expect(screen.getByRole('region', { name: '任务详情' })).toBeTruthy();
  expect(screen.getByText('等待输入')).toBeTruthy();
  expect(screen.getByText('configured')).toBeTruthy();
  expect(screen.queryByText(/sessionFile|auth|trust/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开项目目录' }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '重命名' })); expect(rename).toHaveBeenCalledOnce();
});

it('starts with launchers and keeps review mounted when another tab is active', () => {
  function Harness() {
    const panels = useSidePanelTabs('s1');
    return <UIProvider><button onClick={() => panels.open('task')}>Open details</button><SidePanelHost panels={panels} task={{ id: 's1', cwd: '/work/pua', title: '调查', kind: 'chat', processStatus: 'exited', activity: 'idle', pinned: true }} runtime={null} changes={<p>Git snapshot</p>} onClose={vi.fn()} onOpenProject={vi.fn()} onRename={vi.fn()} onArchive={vi.fn()}/></UIProvider>;
  }
  render(<Harness/>);
  expect(screen.queryByText('Git snapshot')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
  expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByText('Open details'));
  expect(screen.getByRole('region', { name: '任务详情' })).toBeTruthy();
  expect((screen.getByText('Git snapshot').closest('[role=tabpanel]') as HTMLDivElement).hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '关闭 任务详情 标签页' }));
  expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '关闭 Review 标签页' }));
  expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
});

/** @vitest-environment jsdom */
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import './component-preview/test-setup';
import { TaskToolbar } from '../src/renderer/features/workspace';
import { UIProvider } from '../src/renderer/ui';

// This test checks TaskToolbar's action wiring. The shared menu's popup behavior is covered separately.
vi.mock('../src/renderer/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/renderer/ui')>();
  return {
    ...actual,
    DropdownMenu: ({ label, items, onAction }: ComponentProps<typeof actual.DropdownMenu>) => (
      <div role="group" aria-label={label}>
        {items.map(item => (
          <button key={item.value} disabled={item.disabled} onClick={() => onAction(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
    ),
  };
});

it('task toolbar exposes task-scoped actions without inventing a session-level fork', () => {
  const openProject = vi.fn(),
    rename = vi.fn(),
    archive = vi.fn(),
    pin = vi.fn(),
    inspector = vi.fn();
  render(
    <UIProvider>
      <TaskToolbar
        task={{
          id: 's1',
          cwd: '/one/app',
          title: '调查交互',
          kind: 'chat',
          processStatus: 'running',
          activity: 'responding',
          pinned: false,
        }}
        inspectorOpen
        onToggleInspector={inspector}
        onOpenProject={openProject}
        onRename={rename}
        onArchive={archive}
        onTogglePinned={pin}
      />
    </UIProvider>,
  );
  expect(screen.getByRole('banner', { name: '当前任务操作栏' })).toBeTruthy();
  expect(screen.getByText('处理中')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Fork|分支/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重命名任务' }));
  expect(rename).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '置顶任务' }));
  expect(pin).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '归档并关闭任务' }));
  expect(archive).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '打开目录' }));
  expect(openProject).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '收起 检查器' }));
  expect(inspector).toHaveBeenCalledOnce();
});

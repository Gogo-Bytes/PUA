/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../../../component-preview/test-setup';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
import { installDesktopFake } from '../../../desktop-bridge-fake';
import { FilesPanel } from '../../../../src/renderer/features/workspace/FilesPanel';
import { UIProvider } from '../../../../src/renderer/ui';

const session = { id: 's1', cwd: '/work/pua', title: 'Task', kind: 'chat' as const, processStatus: 'running' as const, activity: 'idle' as const };
let desktop: DesktopAPI;
afterEach(() => { vi.restoreAllMocks(); });

it('browses session directories and previews text files without exposing raw filesystem paths', async () => {
  desktop = installDesktopFake({
    listSessionFiles: vi.fn().mockImplementation(async (_id: string, path: string) => path
      ? { path, entries: [{ name: 'index.ts', path: `${path}/index.ts`, kind: 'file' }], truncated: false }
      : { path: '', entries: [{ name: 'src', path: 'src', kind: 'directory' }], truncated: false }),
    readSessionFile: vi.fn().mockResolvedValue({ path: 'src/index.ts', text: 'export const ok = true;', truncated: false }),
  } as unknown as DesktopAPI);
  render(<UIProvider><FilesPanel task={session}/></UIProvider>);
  await screen.findByRole('button', { name: 'src' });
  fireEvent.click(screen.getByRole('button', { name: 'src' }));
  fireEvent.click(await screen.findByRole('button', { name: 'index.ts' }));
  expect(await screen.findByText('export const ok = true;')).toBeTruthy();
  expect(desktop.listSessionFiles).toHaveBeenCalledWith('s1', '');
  expect(desktop.listSessionFiles).toHaveBeenCalledWith('s1', 'src');
  expect(desktop.readSessionFile).toHaveBeenCalledWith('s1', 'src/index.ts');
  fireEvent.click(screen.getByRole('button', { name: '返回文件列表' }));
  expect(screen.getByRole('button', { name: '上级目录' }).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '上级目录' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '上级目录' }).hasAttribute('disabled')).toBe(true));
});

it('explains that draft files become available after the first message creates a session', () => {
  render(<UIProvider><FilesPanel/></UIProvider>);
  expect(screen.getByText(/发送第一条消息创建会话后/)).toBeTruthy();
});

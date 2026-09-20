/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
import { PendingChatPane } from '../../../../src/renderer/features/conversation/PendingChatPane';
import { useState } from 'react';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('project draft composer', () => {
  it('offers pre-session @ skills and stages attachments until the first Pi session exists', async () => {
    vi.useFakeTimers();
    const onStart = vi.fn().mockResolvedValue(undefined);
    const chooseAttachments = vi.fn().mockResolvedValue(['/work/context.txt']);
    installDesktopFake({
      inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: true, paths: ['/work/.agents/skills'], skills: [{ name: 'review-code', source: 'skill', description: '审查代码' }] }),
      chooseAttachments,
    } as unknown as DesktopAPI);
    function Harness() { const [value, setValue] = useState('@rev'); return <PendingChatPane cwd="/work" runtimeAvailable value={value} onValueChange={setValue} onStart={onStart} onSettings={vi.fn()} />; }
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(screen.getByRole('option', { name: /@review-code/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /@review-code/ }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('@review-code ');
    fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
    await act(async () => {});
    expect(chooseAttachments).toHaveBeenCalledOnce();
    expect(screen.getByRole('list', { name: '附件' }).textContent).toContain('context.txt');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'inspect' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await act(async () => {});
    expect(onStart).toHaveBeenCalledWith('inspect', 'default', ['/work/context.txt']);
  });
});

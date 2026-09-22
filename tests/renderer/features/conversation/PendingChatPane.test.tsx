/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
import { PendingChatPane } from '../../../../src/renderer/features/conversation/PendingChatPane';
import { useState, type ComponentProps } from 'react';

// Test the feature-to-UI contract here, not Floating UI layout in jsdom.
// Real popup focus, navigation and callbacks: composer-controls-check.mjs.
vi.mock('../../../../src/renderer/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/renderer/ui')>();
  return { ...actual,
    SuggestionList: ({ items, label, onSelect }: ComponentProps<typeof actual.SuggestionList>) => <div role="listbox" aria-label={label}>{items.map(item => <button key={item.id} role="option" onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>,
    DropdownMenu: ({ label, items, onAction }: ComponentProps<typeof actual.DropdownMenu>) => <button onClick={() => onAction(items[0].value)}>{label}</button>,
  };
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('project draft composer', () => {
  it('offers pre-session @ skills and stages attachments until the first Pi session exists', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const chooseAttachments = vi.fn().mockResolvedValue(['/work/context.txt']);
    installDesktopFake({
      inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: true, paths: ['/work/.agents/skills'], skills: [{ name: 'review-code', source: 'skill', description: '审查代码' }] }),
      chooseAttachments,
    } as unknown as DesktopAPI);
    function Harness() { const [value, setValue] = useState('@rev'); return <PendingChatPane cwd="/work" runtimeAvailable value={value} onValueChange={setValue} onStart={onStart} onSettings={vi.fn()} />; }
    render(<Harness />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length); act(() => editor.focus());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
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

  it('offers native / prompt template candidates without changing their Pi syntax', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    installDesktopFake({
      inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: true, paths: ['/work/.pi/prompts'], prompts: [{ name: 'review', source: 'prompt' }] }),
    } as unknown as DesktopAPI);
    function Harness() { const [value, setValue] = useState('/rev'); return <PendingChatPane cwd="/work" runtimeAvailable value={value} onValueChange={setValue} onStart={onStart} onSettings={vi.fn()} />; }
    render(<Harness />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length); act(() => editor.focus());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    expect(screen.getByRole('option', { name: /\/review/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /\/review/ }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('/review ');
  });

  it('does not advertise inline @ skills that Pi would send literally', async () => {
    installDesktopFake({
      inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: true, paths: ['/work/.pi/skills'], skills: [{ name: 'review-code', source: 'skill' }] }),
    } as unknown as DesktopAPI);
    function Harness() { const [value, setValue] = useState('please @rev'); return <PendingChatPane cwd="/work" runtimeAvailable value={value} onValueChange={setValue} onStart={vi.fn()} onSettings={vi.fn()} />; }
    render(<Harness />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    editor.setSelectionRange(editor.value.length, editor.value.length); act(() => editor.focus());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
    expect(screen.queryByRole('option', { name: /@review-code/ })).toBeNull();
  });
});

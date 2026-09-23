/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    SuggestionList: ({ items, label, onSelect }: ComponentProps<typeof actual.SuggestionList>) => <div role="listbox" aria-label={label}>{items.map(item => <button type="button" key={item.id} role="option" onClick={() => onSelect(item.id)}>{item.label}</button>)}</div>,
    DropdownMenu: ({ label, items, onAction }: ComponentProps<typeof actual.DropdownMenu>) => <button type="button" onClick={() => onAction(items[0].value)}>{label}</button>,
  };
});
vi.mock('../../../../src/renderer/ui/ChoiceControls', () => ({
  Select: ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange(value: string): void }) => <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock('../../../../src/renderer/ui/shadcn-search-select', () => ({
  SearchSelect: ({ label, value, options, onChange, onOpenChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange(value: string): void; onOpenChange?(open: boolean): void }) => <select aria-label={label} value={value} onFocus={() => onOpenChange?.(true)} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));

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
    const trust = await screen.findByRole('dialog', { name: '检测到项目资源' });
    await act(async () => { fireEvent.click(within(trust).getByRole('button', { name: '本次不加载' })); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '检测到项目资源' })).toBeNull());
    expect(onStart).toHaveBeenCalledWith('inspect', 'decline', ['/work/context.txt']);
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
    expect((screen.getByRole('region', { name: '新对话' }).querySelector('textarea') as HTMLTextAreaElement).value).toBe('/review ');
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

  it('loads the no-session Pi catalog on demand and passes choices with the first message', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const getChatModelCatalog = vi.fn().mockResolvedValue([{ provider: 'openai-codex', id: 'gpt-5.5', name: 'gpt-5.5', reasoning: true }]);
    installDesktopFake({ inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: false, paths: [] }), getChatModelCatalog } as unknown as DesktopAPI);
    render(<PendingChatPane cwd="/work" runtimeAvailable value="first prompt" onValueChange={vi.fn()} onStart={onStart} onSettings={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox', { name: '模型' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'gpt-5.5' })).toBeTruthy());
    fireEvent.change(screen.getByRole('combobox', { name: '模型' }), { target: { value: 'openai-codex/gpt-5.5' } });
    fireEvent.change(screen.getByRole('combobox', { name: '思考程度' }), { target: { value: 'high' } });
    fireEvent.submit(screen.getByRole('textbox', { name: '发送消息' }).closest('form')!);
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('first prompt', 'default', [], { model: { provider: 'openai-codex', id: 'gpt-5.5' }, thinkingLevel: 'high' }));
    expect(getChatModelCatalog).toHaveBeenCalledOnce();
  });
});

/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import './component-preview/test-setup';
import { InlineRename, UIProvider } from '../src/renderer/ui';
const setup = (rename = vi.fn()) => { render(<UIProvider><InlineRename value="First session" onRename={rename}/></UIProvider>); return rename; };
const editor = () => screen.getByRole('textbox', { name: 'Rename First session' });
describe('InlineRename interface', () => {
  it('does not rename on a single click; double-click and F2 are equivalent; Escape cancels', async () => {
    const rename = setup(); const display = screen.getByRole('button', { name: 'First session' });
    fireEvent.click(display); expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.doubleClick(display); expect(document.activeElement).toBe(editor());
    fireEvent.change(editor(), { target: { value: 'Draft' } }); fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(rename).not.toHaveBeenCalled(); await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First session' })));
    fireEvent.keyDown(document.activeElement!, { key: 'F2' }); expect((editor() as HTMLInputElement).value).toBe('First session');
  });
  it('blocks empty/IME Enter, preserves draft on blur, and commits trimmed text after composition', async () => {
    const rename = setup(); fireEvent.doubleClick(screen.getByText('First session'));
    fireEvent.change(editor(), { target: { value: '   ' } }); fireEvent.keyDown(editor(), { key: 'Enter' }); expect(screen.getByRole('alert').textContent).toMatch(/empty/); expect(rename).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: ' 中文会话 ' } }); fireEvent.compositionStart(editor()); fireEvent.keyDown(editor(), { key: 'Enter' }); expect(rename).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor()); fireEvent.keyDown(editor(), { key: 'Enter', keyCode: 229 }); expect(rename).not.toHaveBeenCalled();
    fireEvent.blur(editor()); expect((editor() as HTMLInputElement).value).toBe(' 中文会话 ');
    fireEvent.keyDown(editor(), { key: 'Enter' }); await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull()); expect(rename).toHaveBeenCalledWith('中文会话');
  });
  it('keeps async error draft, exposes busy, blocks duplicate saves, and allows retry', async () => {
    let reject!: (reason: Error) => void;
    const rename = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValue(undefined);
    setup(rename); fireEvent.keyDown(screen.getByText('First session'), { key: 'F2' }); fireEvent.change(editor(), { target: { value: 'Keep my draft' } });
    fireEvent.keyDown(editor(), { key: 'Enter' }); expect((editor() as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(editor(), { key: 'Enter' }); expect(rename).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Server refused'))); expect(screen.getByRole('alert').textContent).toBe('Server refused'); expect((editor() as HTMLInputElement).value).toBe('Keep my draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull()); expect(rename).toHaveBeenCalledTimes(2);
  });
  it('does not continue UI work when an async save resolves after unmount', async () => {
    let resolve!: () => void;
    const view = render(<UIProvider><InlineRename value="First session" onRename={() => new Promise<void>(yes => { resolve = yes; })}/></UIProvider>);
    fireEvent.doubleClick(screen.getByText('First session')); fireEvent.keyDown(editor(), { key: 'Enter' }); view.unmount(); await act(async () => resolve()); expect(screen.queryByRole('textbox')).toBeNull();
  });
});

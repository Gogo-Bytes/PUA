/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import './component-preview/test-setup';
import { Composer, type ComposerProps } from '../src/renderer/features/conversation';
import { UIProvider } from '../src/renderer/ui';
const files = [{ id: 'f', name: 'notes.txt' }];
const base: ComposerProps = { conversationKey: 'a', value: 'original', attachments: files, onValueChange: vi.fn() };
const tree = (props: Partial<ComposerProps>) => <UIProvider motion="off"><Composer {...base} {...props}/></UIProvider>;
const editor = () => screen.getByRole('textbox') as HTMLTextAreaElement;
it('Composer uses controlled value/attachments and reports immutable submission without deciding to clear', async () => {
  const send = vi.fn(), change = vi.fn(), remove = vi.fn(), add = vi.fn();
  render(tree({ onSend: send, onValueChange: change, onRemoveAttachment: remove, onAddAttachments: add }));
  fireEvent.change(editor(), { target: { value: 'next' } }); expect(change).toHaveBeenCalledWith('next'); expect(editor().value).toBe('original');
  fireEvent.click(screen.getByRole('button', { name: 'Remove notes.txt' })); expect(remove).toHaveBeenCalledWith('f');
  fireEvent.click(screen.getByRole('button', { name: 'Add attachments' })); expect(add).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send).toHaveBeenCalledWith({ conversationKey: 'a', value: 'original', attachments: files });
  expect(send.mock.calls[0][0].attachments).not.toBe(files); expect(editor().value).toBe('original'); expect(screen.getByText('notes.txt')).toBeTruthy();
});
it('Composer prevents pending duplicates, preserves draft and attachments on failure and allows retry', async () => {
  let reject!: (error: Error) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise<void>((_, no) => { reject = no; })).mockResolvedValue(undefined);
  render(tree({ onSend: send })); fireEvent.keyDown(editor(), { key: 'Enter' }); fireEvent.keyDown(editor(), { key: 'Enter' });
  expect(send).toHaveBeenCalledOnce(); expect(editor().disabled).toBe(false);
  await act(async () => reject(new Error('Rejected'))); expect(screen.getByRole('alert').textContent).toContain('Rejected');
  expect(editor().value).toBe('original'); expect(screen.getByText('notes.txt')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
});
it.each(['external draft', 'attachments', 'conversation', 'round trip'])('Composer ignores stale failure after %s replacement', async change => {
  let reject!: (error: Error) => void;
  const send = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
  const view = render(tree({ onSend: send })); fireEvent.keyDown(editor(), { key: 'Enter' });
  if (change === 'round trip') { view.rerender(tree({ onSend: send, conversationKey: 'b' })); view.rerender(tree({ onSend: send })); }
  else view.rerender(tree({ onSend: send, ...(change === 'external draft' ? { value: 'new draft' } : change === 'attachments' ? { attachments: [{ id: 'new', name: 'new.txt' }] } : { conversationKey: 'b', value: 'session B' }) }));
  const value = editor().value;
  await act(async () => reject(new Error('Old session error')));
  expect(screen.queryByRole('alert')).toBeNull(); expect(editor().value).toBe(value);
});
it('Composer permits composing the next draft during async send and never clears it on success', async () => {
  let resolve!: () => void;
  function Adapter() { const [value, setValue] = useState('first'); return <Composer {...base} value={value} onValueChange={setValue} onSend={() => new Promise<void>(yes => { resolve = yes; })}/>; }
  render(<UIProvider><Adapter/></UIProvider>); fireEvent.keyDown(editor(), { key: 'Enter' }); fireEvent.change(editor(), { target: { value: 'next draft' } });
  await act(async () => resolve()); expect(editor().value).toBe('next draft');
});
it('Composer IME Enter/229 and Shift+Enter do not submit; normal Enter does; attachments-only is valid', async () => {
  const send = vi.fn(); render(tree({ onSend: send, value: '' }));
  fireEvent.compositionStart(editor()); fireEvent.keyDown(editor(), { key: 'Enter' }); fireEvent.compositionEnd(editor());
  fireEvent.keyDown(editor(), { key: 'Enter', keyCode: 229 }); fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true }); fireEvent.keyDown(editor(), { key: 'Enter', shiftKey: true });
  expect(send).not.toHaveBeenCalled(); fireEvent.keyDown(editor(), { key: 'Enter' }); await waitFor(() => expect(send).toHaveBeenCalledOnce());
});
it('Composer running state offers queue/stop with independent locks, editable input and Chinese labels', async () => {
  let finishQueue!: () => void, finishStop!: () => void;
  const queue = vi.fn(() => new Promise<void>(yes => { finishQueue = yes; })), stop = vi.fn(() => new Promise<void>(yes => { finishStop = yes; }));
  render(tree({ busy: true, queuedCount: 2, onQueue: queue, onStop: stop, onAddAttachments: vi.fn(), onRemoveAttachment: vi.fn(), labels: { message: '消息', placeholder: '描述任务', send: '发送', queue: '排队', stop: '停止', addAttachments: '添加附件', removeAttachment: name => `移除 ${name}`, queued: count => `${count} 条待处理` } }));
  expect(screen.getByRole('textbox', { name: '消息' }).getAttribute('placeholder')).toBe('描述任务'); expect(editor().disabled).toBe(false);
  expect(screen.getByRole('button', { name: '添加附件' })).toBeTruthy(); expect(screen.getByRole('button', { name: '移除 notes.txt' })).toBeTruthy(); expect(screen.getByText('2 条待处理')).toBeTruthy();
  fireEvent.keyDown(editor(), { key: 'Enter' }); fireEvent.keyDown(editor(), { key: 'Enter' }); expect(queue).toHaveBeenCalledOnce();
  const button = screen.getByRole('button', { name: '停止' }); fireEvent.click(button); fireEvent.click(button); expect(stop).toHaveBeenCalledOnce(); expect(editor().disabled).toBe(false);
  await act(async () => { finishQueue(); finishStop(); });
});
it('Composer explicit disabled blocks controls; pending unmount does no UI work', async () => {
  let reject!: (error: Error) => void; const send = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
  const view = render(tree({ disabled: true, onSend: send })); fireEvent.keyDown(editor(), { key: 'Enter' }); expect(send).not.toHaveBeenCalled(); expect(editor().disabled).toBe(true);
  view.rerender(tree({ onSend: send })); fireEvent.keyDown(editor(), { key: 'Enter' }); view.unmount(); await act(async () => reject(new Error('late'))); expect(screen.queryByRole('alert')).toBeNull();
});

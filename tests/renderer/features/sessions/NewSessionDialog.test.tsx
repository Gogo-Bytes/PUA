/** @vitest-environment jsdom */
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSessionDialog } from '../../../../src/renderer/features/sessions';

type Props = ComponentProps<typeof NewSessionDialog>;
const pathInput = () => screen.getByRole('textbox', { name: '项目文件夹' }) as HTMLInputElement;
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
const submit = () => fireEvent.submit(pathInput().closest('form')!);
let props: Props;
let inspect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  inspect = vi.fn().mockResolvedValue({ hasResources: false, paths: [] });
  installDesktopFake({ inspectProjectResources: inspect, chooseDirectory: vi.fn().mockResolvedValue(null) } as unknown as DesktopAPI);
  props = { initialPath: '/a', hasRuntime: true, onClose: vi.fn(), onCreate: vi.fn().mockResolvedValue(undefined), onSettings: vi.fn() };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('NewSessionDialog without advisory resource gate', () => {
  it('requests an explicit project-resource choice only when launch is submitted', async () => {
    inspect.mockResolvedValue({ hasResources: true, paths: ['/a/.pi'] });
    render(<NewSessionDialog {...props} />);
    expect(pathInput().required).toBe(true);
    expect(radio(/^原生对话/).checked).toBe(true);
    fireEvent.change(pathInput(), { target: { value: ' /b ' } });
    await act(async () => { submit(); });
    await screen.findByText('检测到项目资源');
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledExactlyOnceWith(' /b ');
    fireEvent.click(radio(/^本次信任并加载项目资源/));
    await act(async () => { submit(); });
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith(' /b ', 'chat', 'new', 'approve');
    expect(screen.getByText('检测到项目资源')).toBeTruthy();
  });
  it.each(['', '   '])('rejects blank paths for both launch kinds: %j', cwd => {
    render(<NewSessionDialog {...props} initialPath={cwd} />);
    submit(); fireEvent.click(radio(/^兼容终端/)); submit();
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
  });
  it('resets terminal resume when switching to chat', async () => {
    render(<NewSessionDialog {...props} initialKind="terminal" />);
    fireEvent.click(radio(/^选择历史/)); fireEvent.click(radio(/^原生对话/));
    expect(radio(/^新会话/).checked).toBe(true);
    expect(screen.queryByRole('radio', { name: /^选择历史/ })).toBeNull();
    await act(async () => { submit(); });
    expect(props.onCreate).toHaveBeenCalledWith('/a', 'chat', 'new', 'default');
  });
  it('locks entry-specific terminal launchers', async () => {
    render(<NewSessionDialog {...props} initialKind="terminal" fixedKind="terminal" />);
    expect(screen.queryByRole('radio', { name: /^原生对话/ })).toBeNull();
    expect(radio(/^兼容终端/).disabled).toBe(true);
    await act(async () => { submit(); });
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith('/a', 'terminal', 'new', 'default');
  });
  it('prevents duplicate submission and permits retry after failure', async () => {
    let reject!: (reason: unknown) => void;
    vi.mocked(props.onCreate).mockReturnValueOnce(new Promise<void>((_, no) => { reject = no; }));
    render(<NewSessionDialog {...props} />); await act(async () => { submit(); }); await act(async () => { submit(); });
    await vi.waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    await act(async () => { reject('create failed'); });
    expect(screen.getByRole('alert').textContent).toBe('create failed');
    await act(async () => { submit(); });
    expect(props.onCreate).toHaveBeenCalledTimes(2);
  });
  it('offers runtime settings and closes using Escape', () => {
    render(<NewSessionDialog {...props} hasRuntime={false} />);
    fireEvent.click(screen.getByRole('button', { name: '先配置 Pi' }));
    expect(props.onSettings).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

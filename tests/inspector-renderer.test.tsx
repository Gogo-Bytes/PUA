/** @vitest-environment jsdom */
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitPanel } from '../src/renderer/features/change-review';
import { CopyButton, MarkdownView } from '../src/renderer/ContentView';
import { ToolCard } from '../src/renderer/features/conversation';
import type { FileDiff } from '../src/shared/ipc/change-review';
import combinedConflict from './fixtures/combined-conflict.patch?raw';

beforeEach(() => {
  desktop = installDesktopFake({
    gitStatus: vi.fn().mockResolvedValue({ root: '/repo', branch: 'main', capturedAt: '2026-01-01T00:00:00Z', files: [
      { path: 'tracked.ts', index: 'M', worktree: 'M' }, { path: 'notes.md', index: '?', worktree: '?' },
    ] }),
    fileDiff: vi.fn().mockResolvedValue({ kind: 'diff', truncated: false, text: '--- a/tracked.ts\n+++ b/tracked.ts\n@@ -8,2 +8,2 @@\n same\n-old\n+new' }),
    writeClipboard: vi.fn().mockResolvedValue(undefined), openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI);
});
afterEach(cleanup);

describe('inspector data boundary', () => {
  it('shows actual hunk counts and numbers, distinguishes scope, and references without sending', async () => {
    const onReference = vi.fn(); const { container } = render(<GitPanel sessionId="s1" onClose={() => {}} onReference={onReference} />);
    fireEvent.click(await screen.findByRole('button', { name: 'tracked.ts M' }));
    await screen.findByText('+1'); expect(screen.getByText('−1')).toBeTruthy();
    expect(desktop.fileDiff).toHaveBeenCalledWith('s1', 'tracked.ts', 'worktree');
    expect(container.querySelector('.deletion .line-number')?.textContent).toBe('9');
    expect(screen.queryByRole('button', { name: '预览' })).toBeNull(); expect(screen.queryByRole('button', { name: '源码' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '引用文件到草稿' })); expect(onReference).toHaveBeenCalledWith('请检查这个文件的变更：@"/repo/tracked.ts" ');
    fireEvent.click(screen.getByRole('button', { name: '复制差异输出' })); await waitFor(() => expect(desktop.writeClipboard).toHaveBeenCalledWith(expect.stringContaining('@@ -8,2 +8,2 @@')));
    fireEvent.click(screen.getByRole('button', { name: /暂存区 1/ })); expect(screen.queryByRole('button', { name: /notes.md/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'tracked.ts M' })); await waitFor(() => expect(desktop.fileDiff).toHaveBeenLastCalledWith('s1', 'tracked.ts', 'index'));
    await screen.findByText(/HEAD → 暂存区/); expect(screen.getByText(/非原子快照/)).toBeTruthy();
  });
  it.each([
    { text: combinedConflict, index: 'M', worktree: 'M', scope: 'worktree', truncated: false },
    { text: combinedConflict.replace('diff --cc', 'diff --combined'), index: 'M', worktree: 'M', scope: 'worktree', truncated: true },
    { text: combinedConflict.slice(combinedConflict.indexOf('@@@')), index: 'M', worktree: 'M', scope: 'worktree', truncated: false },
    { text: '@@ -1 +1 @@\n-old\n+new', index: 'U', worktree: 'U', scope: 'index', truncated: true },
  ])('shows raw conflict output without invalid counts, line numbers or two-sided source ($scope)', async ({ text, index, worktree, scope, truncated }) => {
    vi.mocked(desktop.gitStatus).mockResolvedValue({ root: '/repo', branch: 'main', capturedAt: '2026-01-01T00:00:00Z', files: [{ path: 'conflict.txt', index, worktree }] });
    vi.mocked(desktop.fileDiff).mockResolvedValue({ kind: 'diff', text, truncated });
    const { container } = render(<GitPanel sessionId="s1" onClose={() => {}} onReference={() => {}} />);
    await screen.findByRole('button', { name: `conflict.txt ${worktree}` });
    if (scope === 'index') fireEvent.click(screen.getByRole('button', { name: '暂存区 1' }));
    fireEvent.click(screen.getByRole('button', { name: `conflict.txt ${scope === 'index' ? index : worktree}` }));
    expect((await screen.findByLabelText('原始冲突 patch')).textContent).toBe(text);
    expect(screen.getByText('冲突 · 原始 patch')).toBeTruthy();
    expect(container.querySelector('.addition-text, .deletion-text, .line-number, .diff-sign')).toBeNull();
    expect(screen.queryByText(/HEAD → 暂存区|暂存区 → 工作区|计数仅涵盖/)).toBeNull();
    expect(screen.queryByLabelText('文件差异（左侧原行号，右侧新行号）')).toBeNull();
    expect(screen.queryByRole('button', { name: '源码' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制差异输出' }));
    await waitFor(() => expect(desktop.writeClipboard).toHaveBeenCalledWith(text));
  });
  it('renders preview/source solely from untracked text returned by fileDiff, never reconstructs a tracked file', async () => {
    const source = '# Real notes\n\nactual content\n\n![remote](https://example.com/secret.png)';
    vi.mocked(desktop.fileDiff).mockResolvedValue({ kind: 'untracked', truncated: true, text: source });
    const { container } = render(<GitPanel sessionId="s1" onClose={() => {}} onReference={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'notes.md ?' })); await screen.findByText(/工作区未跟踪文本快照/);
    expect(screen.getByText(/内容已截断/)).toBeTruthy(); expect(screen.getByLabelText('未跟踪文件源码快照').textContent).toContain('# Real notes');
    fireEvent.click(screen.getByRole('button', { name: '预览' })); expect(screen.getByRole('heading', { name: 'Real notes' })).toBeTruthy(); expect(container.querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制文件快照' })); await waitFor(() => expect(desktop.writeClipboard).toHaveBeenCalledWith(source));
    expect(desktop.fileDiff).toHaveBeenCalledTimes(1);
  });
  it('ignores stale scope requests and visibly reports failures; binary/symlink results have no file preview', async () => {
    let resolveOld!: (value: FileDiff) => void;
    vi.mocked(desktop.fileDiff).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ kind: 'symlink', truncated: false, text: '符号链接 → /outside' });
    render(<GitPanel sessionId="s1" onClose={() => {}} onReference={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'tracked.ts M' }));
    fireEvent.click(screen.getByRole('button', { name: /暂存区 1/ })); fireEvent.click(screen.getByRole('button', { name: 'tracked.ts M' }));
    await screen.findByText('符号链接 → /outside');
    await act(async () => resolveOld({ kind: 'untracked', truncated: false, text: 'stale secret' })); expect(screen.queryByText('stale secret')).toBeNull(); expect(screen.queryByRole('button', { name: '预览' })).toBeNull();
    vi.mocked(desktop.gitStatus).mockRejectedValueOnce(new Error('git unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '刷新' })); await screen.findByRole('alert'); expect(screen.getByText('Error: git unavailable')).toBeTruthy();
    expect(screen.queryByText('符号链接 → /outside')).toBeNull();
  });
});

describe('real content actions', () => {
  it('keeps clipboard and external link errors visible instead of reporting success', async () => {
    vi.mocked(desktop.writeClipboard).mockRejectedValue(new Error('clipboard denied'));
    vi.mocked(desktop.openExternal).mockRejectedValue(new Error('blocked protocol'));
    render(<><CopyButton text="actual output" label="复制内容" /><MarkdownView text="[real](https://example.com)" /></>);
    fireEvent.click(screen.getByRole('button', { name: '复制内容' })); await screen.findByText(/clipboard denied/); expect(screen.queryByText('已复制')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'real' })); await screen.findByText(/blocked protocol/);
  });
  it('retains unknown tool arguments, images, output and source boundaries in the real disclosure', async () => {
    const tool = { id: 'custom', name: 'extension_custom', arguments: { arbitrary: 'value' }, status: 'success' as const, output: 'one\ntwo', images: [{ type: 'image' as const, mimeType: 'image/png', data: 'eA==' }] };
    const { container } = render(<ToolCard tool={tool} />);
    expect(container.querySelector('details')?.open).toBe(false);
    fireEvent.click(screen.getByText('extension_custom')); await waitFor(() => expect(container.querySelector('details')?.open).toBe(true));
    expect(screen.getByText(/"arbitrary": "value"/)).toBeTruthy(); expect(screen.getByText(/工具返回快照 · 2 行输出/)).toBeTruthy(); expect(screen.getByText(/不代表当前磁盘文件/)).toBeTruthy();
    expect(screen.getByRole('img', { name: '工具结果图片' }).getAttribute('src')).toBe('data:image/png;base64,eA==');
    fireEvent.click(screen.getByRole('button', { name: '复制工具输出' })); await waitFor(() => expect(desktop.writeClipboard).toHaveBeenCalledWith('one\ntwo'));
  });
});

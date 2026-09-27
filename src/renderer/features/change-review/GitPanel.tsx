import { desktopClient } from '../../app/desktop-client';
import { useEffect, useRef, useState } from 'react';
import type { ChangedFile, DiffScope, FileDiff, GitStatus } from '../../../shared/ipc/change-review';
import { filesForScope } from './scope';
import { referencePaths } from '../workspace';
import { Button, DiffView, Icon, IconButton, Tabs } from '../../ui';
import { CopyButton, MarkdownView, SourceView } from '../content';
import { isConflictPatch, parseDiffLines } from './diff-lines';

type Result = { diff: FileDiff; receivedAt: string } | { error: string };
const PAGE_SIZE = 5;

export function GitPanel(props: { sessionId: string; theme?: 'light' | 'dark'; onClose(): void; onReference(text: string): void }) {
  return <Review key={props.sessionId} {...props}/>;
}

function Review({ sessionId, theme = 'light', onReference }: Parameters<typeof GitPanel>[0]) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [scope, setScope] = useState<DiffScope>('worktree');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = async () => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const next = await desktopClient.gitStatus(sessionId);
      if (generation.current === request) { setStatus(next); setRevision(value => value + 1); }
    } catch (error) {
      if (generation.current === request) { setStatus(null); setError(String(error)); }
    } finally { if (generation.current === request) setBusy(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [sessionId]);
  const files = status ? filesForScope(status.files, scope) : [];
  return <aside className="git-panel" aria-label="文件与 Git 检查区">
    <div className="review-toolbar">
      <div className="review-scope" role="group" aria-label="变更范围">
        {(['worktree', 'index'] as const).map(value => <Button key={value} variant="ghost" className={scope === value ? 'is-active' : ''} aria-label={`查看${value === 'index' ? '暂存区' : '工作区'}变更`} aria-pressed={scope === value} onClick={() => setScope(value)}><Icon name={value === 'index' ? 'branch' : 'review'}/></Button>)}
      </div>
      <IconButton icon="refresh" label={busy ? '刷新中…' : '刷新'} disabled={busy} variant="ghost" onClick={() => void refresh()}/>
    </div>
    <div className="review-branch" aria-label="分支比较">
      <span className="review-branch-ref">{status?.branch || 'Git'}</span><Icon name="forward"/><span className="review-branch-target" aria-label={scope === 'index' ? '暂存区' : '工作区'}><Icon name={scope === 'index' ? 'branch' : 'review'}/></span>
    </div>
    <div className="inspector-scroll">
      {error && <div className="git-empty" role="alert"><h3>暂时无法读取 Git</h3><p>请确认启动目录位于 Git 仓库内。不会自动初始化仓库或更改文件。</p><pre>{error}</pre></div>}
      {busy && !status && <p className="diff-note">读取变更…</p>}
      {status && !files.length && <div className="git-empty"><Icon name="check"/><h3>这个范围没有变更</h3><p>修改文件后刷新，或切换暂存范围。</p></div>}
      {status && <ReviewFiles key={`${scope}:${revision}`} status={status} files={files} sessionId={sessionId} scope={scope} theme={theme} onReference={onReference}/>}
    </div>
  </aside>;
}

function ReviewFiles({ status, files, sessionId, scope, theme, onReference }: {
  status: GitStatus; files: ChangedFile[]; sessionId: string; scope: DiffScope; theme: 'light' | 'dark'; onReference(text: string): void;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [results, setResults] = useState<Map<string, Result>>(() => new Map());
  const loaded = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const queue = files.slice(0, limit).filter(file => !loaded.current.has(file.path));
    const worker = async () => {
      while (!cancelled && queue.length) {
        const file = queue.shift()!;
        let result: Result;
        try { result = { diff: await desktopClient.fileDiff(sessionId, file.path, scope), receivedAt: new Date().toLocaleTimeString() }; }
        catch (error) { result = { error: String(error) }; }
        if (cancelled) return;
        loaded.current.add(file.path);
        setResults(current => new Map(current).set(file.path, result));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return () => { cancelled = true; };
  }, [sessionId, scope, status, limit]);
  const visible = files.slice(0, limit);
  const loading = visible.some(file => !results.get(file.path));
  const totals = visible.reduce((summary, file) => {
    const result = results.get(file.path);
    if (!result || 'error' in result) return summary;
    if (result.diff.kind === 'untracked') return { added: summary.added + result.diff.text.split('\n').length, deleted: summary.deleted };
    if (result.diff.kind !== 'diff' || isConflictPatch(result.diff.text, file)) return summary;
    const rows = parseDiffLines(result.diff.text, file);
    return { added: summary.added + rows.filter(row => row.kind === 'addition').length, deleted: summary.deleted + rows.filter(row => row.kind === 'deletion').length };
  }, { added: 0, deleted: 0 });
  const [selectedPath, setSelectedPath] = useState(files[0]?.path);
  useEffect(() => { setSelectedPath(current => files.some(file => file.path === current) ? current : files[0]?.path); }, [files]);
  const selectedFile = visible.find(file => file.path === selectedPath);
  return <div className="review-files" aria-label="变更文件">
    <div className="review-overview"><strong>{status.branch || '本地变更'}</strong><div className="review-overview-counts">{totals.added > 0 && <span className="addition-text">+{totals.added}</span>}{totals.deleted > 0 && <span className="deletion-text">−{totals.deleted}</span>}</div></div>
    <div className="review-file-list">
      {visible.map(file => <ReviewFile key={file.path} file={file} result={results.get(file.path)} selected={selectedPath === file.path} onSelect={() => setSelectedPath(file.path)} onReference={() => onReference(`请检查这个文件的变更：${referencePaths([status.root.replace(/[\\/]$/, '') + '/' + file.path])}`)}/>)}
    </div>
    {selectedFile && <ReviewFileDetail file={selectedFile} result={results.get(selectedFile.path)} sessionId={sessionId} scope={scope} theme={theme}/>}
    {limit < files.length && <Button className="review-load-more" disabled={loading} onClick={() => setLimit(current => current + PAGE_SIZE)}>{loading ? '读取差异…' : `继续加载 ${Math.min(PAGE_SIZE, files.length - limit)} 个文件`} · 共 {files.length} 个</Button>}
  </div>;
}

function ReviewFile({ file, result, selected, onSelect, onReference }: { file: ChangedFile; result?: Result; selected: boolean; onSelect(): void; onReference(): void }) {
  const [expanded, setExpanded] = useState(true);
  const diff = result && 'diff' in result ? result.diff : null;
  const conflict = diff?.kind === 'diff' && isConflictPatch(diff.text, file);
  const rows = diff?.kind === 'diff' && !conflict ? parseDiffLines(diff.text) : [];
  const statusLabel = file.originalPath ? 'R' : file.index === '?' || file.worktree === '?' ? 'U' : file.index.includes('D') || file.worktree.includes('D') ? 'D' : 'M';
  return <section className="review-file" aria-label={file.path}>
    <div className="review-file-heading" data-selected={selected || undefined}>
      <Button variant="ghost" aria-label={file.path} aria-expanded={selected && expanded} onClick={() => { onSelect(); setExpanded(true); }} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}>
        <span className={`review-file-status review-file-status-${statusLabel.toLowerCase()}`}>{statusLabel}</span><Icon name="chevron" className={expanded ? 'is-expanded' : ''}/><span>{file.path}</span>
      </Button>
      {diff?.kind === 'diff' && !conflict && <span className="review-count"><span className="addition-text">+{rows.filter(row => row.kind === 'addition').length}</span> <span className="deletion-text">−{rows.filter(row => row.kind === 'deletion').length}</span>{diff.truncated && <small>部分</small>}</span>}
      <div className="review-file-actions"><IconButton icon="link" label="引用文件到草稿" variant="ghost" onClick={onReference}/>
        {diff && <CopyButton text={diff.text} label={diff.kind === 'untracked' ? '复制文件快照' : '复制差异输出'}/>}</div>
    </div>
  </section>;
}

function ReviewFileDetail({ file, result, sessionId, scope, theme }: { file: ChangedFile; result?: Result; sessionId: string; scope: DiffScope; theme: 'light' | 'dark' }) {
  const [view, setView] = useState<'source' | 'preview'>('source');
  const diff = result && 'diff' in result ? result.diff : null;
  const conflict = diff?.kind === 'diff' && isConflictPatch(diff.text, file);
  const markdown = diff?.kind === 'untracked' && /\.(md|markdown)$/i.test(file.path);
  return <div className="review-diff-pane" aria-label={`文件差异：${file.path}`}>
    {!result && <p className="diff-note">读取差异…</p>}
    {result && 'error' in result && <p role="alert" className="diff-note form-error">{result.error}</p>}
    {diff && <>
      <div className="review-file-meta">{conflict ? '冲突 · 原始 patch' : diff.kind === 'diff' ? scope === 'index' ? 'HEAD → 暂存区' : '暂存区 → 工作区' : diff.kind === 'untracked' ? '工作区未跟踪文本快照' : diff.kind === 'binary' ? '二进制 · 无文本预览' : '符号链接 · 不读取目标'}</div>
      {diff.truncated && <p className="diff-note">内容已截断（约前 200KB）；{conflict ? '仅保留已返回的原始 patch。' : '计数仅涵盖已显示差异，不代表完整文件。'}</p>}
      {markdown && <Tabs label="文件视图" value={view} onChange={value => setView(value as 'source' | 'preview')} items={[{ value: 'source', label: '源码' }, { value: 'preview', label: '预览' }]}/>}
      {conflict || (diff.kind === 'diff' && diff.truncated) ? <pre className="diff-content" aria-label={conflict ? '原始冲突 patch' : '已截断 patch'}>{diff.text}</pre>
        : diff.kind === 'diff' ? <DiffView text={diff.text} theme={theme} loadDiffFiles={() => desktopClient.fileDiffContents(sessionId, file.path, scope)}/>
        : diff.kind === 'untracked' ? markdown && view === 'preview' ? <div className="document ui-chat-body"><MarkdownView text={diff.text}/></div> : <SourceView text={diff.text} label="未跟踪文件源码快照"/>
        : <p className="diff-note">{diff.text}</p>}
    </>}
  </div>;
}

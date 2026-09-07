import { useEffect, useRef, useState } from 'react';
import { filesForScope, type DiffScope, type FileDiff, type GitStatus } from '../shared/git';
import { referencePaths } from './terminal-keys';
import { Icon } from './Icon';
import { CopyButton, MarkdownView, SourceView } from './ContentView';
import { isConflictPatch, parseDiffLines } from './diff-lines';

export function GitPanel({ sessionId, onClose, onReference }: { sessionId: string; onClose(): void; onReference(text: string): void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [scope, setScope] = useState<DiffScope>('worktree');
  const [selected, setSelected] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [receivedAt, setReceivedAt] = useState('');
  const [view, setView] = useState<'source' | 'preview'>('source');
  const [error, setError] = useState('');
  const [diffError, setDiffError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const refresh = async () => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      const next = await window.desktop.gitStatus(sessionId);
      if (generation.current !== request) return;
      setStatus(next);
      setSelected(current => filesForScope(next.files, currentScope.current).some(file => file.path === current) ? current : '');
    } catch (error) {
      if (generation.current === request) { setStatus(null); setSelected(''); setDiff(null); setError(String(error)); }
    } finally { if (generation.current === request) setBusy(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setDiff(null); setDiffError(''); setReceivedAt(''); setView('source');
    if (!selected || !status) { setLoadingDiff(false); return; }
    setLoadingDiff(true);
    void window.desktop.fileDiff(sessionId, selected, scope).then(next => { if (!cancelled) { setDiff(next); setReceivedAt(new Date().toLocaleTimeString()); } })
      .catch(error => { if (!cancelled) setDiffError(String(error)); })
      .finally(() => { if (!cancelled) setLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [sessionId, selected, scope, status]);

  const files = status ? filesForScope(status.files, scope) : [];
  const selectedFile = status?.files.find(file => file.path === selected);
  const rawConflict = diff?.kind === 'diff' && isConflictPatch(diff.text, selectedFile);
  const rows = diff?.kind === 'diff' && !rawConflict ? parseDiffLines(diff.text) : [];
  const added = rows.filter(row => row.kind === 'addition').length;
  const removed = rows.filter(row => row.kind === 'deletion').length;
  const markdown = diff?.kind === 'untracked' && /\.(md|markdown)$/i.test(selected);
  return <aside className="git-panel" aria-label="文件与 Git 检查区">
    <header><div><Icon name="file" /><h2>文件与 Git</h2><span className="count">{status?.files.length ?? '—'}</span></div><button className="icon-button" aria-label="关闭变更面板" onClick={onClose}><Icon name="close" /></button></header>
    <div className="git-summary"><span title={status?.root}><Icon name="folder" />{status?.branch || 'Git 工作区'}</span><button onClick={() => void refresh()} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button></div>
    <p className="git-disclaimer">会话启动目录所属仓库的全部变更，包含你和其他工具的修改。只读快照，<strong>不代表 Pi 本轮改动</strong>。</p>
    <div className="git-scopes" role="group" aria-label="变更范围">{([['worktree', '工作区 · 未暂存'], ['index', '暂存区']] as const).map(([value, title]) => <button aria-pressed={scope === value} key={value} onClick={() => { setScope(value); setSelected(''); }}>{title}<span>{status ? filesForScope(status.files, value).length : '—'}</span></button>)}</div>
    <div className="inspector-scroll">
      {error && <div className="git-empty" role="alert"><h3>暂时无法读取 Git</h3><p>请确认启动目录位于 Git 仓库内，且系统 PATH 可找到 Git。不会自动初始化仓库或更改文件。</p><details><summary>诊断详情</summary><pre>{error}</pre></details></div>}
      {status && files.length === 0 && <div className="git-empty"><Icon name="check" /><h3>这个范围没有变更</h3><p>修改文件后点击刷新，或切换暂存范围。</p></div>}
      {files.length > 0 && <div className="changed-files" aria-label="变更文件">{files.map(file => <button key={file.path} aria-pressed={file.path === selected} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} onClick={() => setSelected(file.path)}><Icon name="file" /><span>{file.path}</span><code className={`file-status ${file.index === '?' ? 'added' : ''}`}>{file.index === '?' ? '?' : scope === 'index' ? file.index : file.worktree}</code></button>)}</div>}
      {!!selected && status && <><div className="diff-heading"><code title={selected}>{selected}</code><button title="引用路径到当前草稿，不自动发送" aria-label="引用文件到草稿" onClick={() => {
        const fullPath = `${status.root.replace(/[\\/]$/, '')}/${selected}`;
        onReference(`请检查这个文件的变更：${referencePaths([fullPath])}`);
      }}><Icon name="link" />引用</button></div>{loadingDiff && <p className="diff-note">读取差异…</p>}{diffError && <p className="form-error diff-note" role="alert">{diffError}</p>}{diff && <>
        <div className="diff-toolbar"><span>{rawConflict ? '冲突 · 原始 patch' : diff.kind === 'diff' ? <><span className="addition-text">+{added}</span> <span className="deletion-text">−{removed}</span>{diff.truncated ? ' · 已显示部分' : ' · 差异'}</> : diff.kind === 'untracked' ? '未跟踪 · 文件内容' : diff.kind === 'binary' ? '二进制 · 无文本预览' : '符号链接 · 不读取目标'}</span><CopyButton text={diff.text} label={diff.kind === 'untracked' ? '复制文件快照' : '复制差异输出'} /></div>
        <p className="diff-note">{rawConflict ? '未合并 / 多父差异原始输出，不提供双边统计或文件行号' : scope === 'index' ? 'HEAD → 暂存区' : diff.kind === 'untracked' ? '工作区未跟踪文本快照' : '暂存区 → 工作区'} · 响应于 {receivedAt}。文件列表与内容分别读取，非原子快照。</p>
        {diff.truncated && <p className="diff-note">内容已截断（约前 200KB）；{rawConflict ? '仅保留已返回的原始 patch。' : '计数仅涵盖已显示差异，不代表完整文件。'}</p>}
        {markdown && <div className="reader-views" role="group" aria-label="文件视图"><button aria-pressed={view === 'source'} onClick={() => setView('source')}>源码</button><button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>预览</button></div>}
        {rawConflict ? <pre className="diff-content" aria-label="原始冲突 patch">{diff.text}</pre> : diff.kind === 'diff' ? <div className="diff-content" aria-label="文件差异（左侧原行号，右侧新行号）">{rows.map((row, index) => <div key={index} className={`diff-line ${row.kind}`}><span className="line-number" aria-hidden="true">{row.old}</span><span className="line-number" aria-hidden="true">{row.next}</span><span className="diff-sign">{row.kind === 'addition' ? '+' : row.kind === 'deletion' ? '−' : ' '}</span><code>{row.text || ' '}</code></div>)}</div> : diff.kind === 'untracked' ? markdown && view === 'preview' ? <div className="document message-body"><MarkdownView text={diff.text} /></div> : <SourceView text={diff.text} label="未跟踪文件源码快照" /> : <p className="diff-note">{diff.text}</p>}
      </>}</>}
      {!selected && files.length > 0 && <div className="git-empty"><h3>选择文件，查看真实差异</h3><p>已跟踪文件只提供 Git patch；不将差异伪装成完整源码。未跟踪文本可查看源码，Markdown 可预览。</p></div>}
    </div>
    {status && <div className="git-timestamp" title={status.root}>列表快照 {new Date(status.capturedAt).toLocaleTimeString()} · 手动刷新</div>}
  </aside>;
}

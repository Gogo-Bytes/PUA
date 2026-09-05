import { useEffect, useRef, useState } from 'react';
import { filesForScope, type DiffScope, type FileDiff, type GitStatus } from '../shared/git';
import { referencePaths } from './terminal-keys';

export function GitPanel({ sessionId, onClose, onReference }: { sessionId: string; onClose(): void; onReference(text: string): void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [scope, setScope] = useState<DiffScope>('worktree');
  const [selected, setSelected] = useState('');
  const [diff, setDiff] = useState<FileDiff | null>(null);
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
  useEffect(() => {
    void refresh();
    return () => { generation.current++; };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    setDiff(null); setDiffError('');
    if (!selected || !status) { setLoadingDiff(false); return; }
    setLoadingDiff(true);
    void window.desktop.fileDiff(sessionId, selected, scope).then(next => { if (!cancelled) setDiff(next); })
      .catch(error => { if (!cancelled) setDiffError(String(error)); })
      .finally(() => { if (!cancelled) setLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [sessionId, selected, scope, status?.capturedAt]);

  const files = status ? filesForScope(status.files, scope) : [];
  return <aside className="git-panel" aria-label="Git 变更审查">
    <header><div><span className="eyebrow">REVIEW CHANGES</span><h2>变更审查 <span>{status?.files.length ?? '—'}</span></h2></div><button aria-label="关闭变更面板" onClick={onClose}>×</button></header>
    <div className="git-summary"><span title={status?.root}>⌁ {status?.branch || 'Git 工作区'}</span><button onClick={() => void refresh()} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button></div>
    <p className="git-disclaimer">当前会话<strong>启动目录</strong>所属仓库的全部变更，包含你和其他工具的修改。只读预览，不代表 Pi 本轮改动。</p>
    <div className="git-scopes" role="tablist" aria-label="变更范围">{([['worktree', '未暂存'], ['index', '已暂存']] as const).map(([value, title]) => <button role="tab" aria-selected={scope === value} key={value} className={scope === value ? 'selected' : ''} onClick={() => { setScope(value); setSelected(''); }}>{title}<span>{status ? filesForScope(status.files, value).length : '—'}</span></button>)}</div>
    {error && <div className="git-empty" role="alert"><h3>暂时无法读取 Git</h3><p>请确认启动目录位于 Git 仓库内，且系统 PATH 可找到 Git。不会自动初始化仓库或更改文件。</p><details><summary>诊断详情</summary><pre>{error}</pre></details></div>}
    {status && files.length === 0 && <div className="git-empty"><span>✓</span><h3>这个范围没有变更</h3><p>修改文件后点击刷新，或切换暂存范围。</p></div>}
    {files.length > 0 && <div className="changed-files" aria-label="变更文件">{files.map(file => <button key={file.path} className={file.path === selected ? 'selected' : ''} title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path} onClick={() => setSelected(file.path)}><code className={`file-status ${file.index === '?' ? 'added' : ''}`}>{file.index === '?' ? '+' : scope === 'index' ? file.index : file.worktree}</code><span>{file.path}</span><span>›</span></button>)}</div>}
    {!!selected && status && <><div className="diff-heading"><code title={selected}>{selected}</code><button onClick={() => {
      const fullPath = `${status.root.replace(/[\\/]$/, '')}/${selected}`;
      onReference(`请检查这个文件的变更：${referencePaths([fullPath])}`);
    }}>引用给 Pi ↗</button></div>{loadingDiff && <p className="diff-note">读取差异…</p>}{diffError && <p className="form-error diff-note" role="alert">{diffError}</p>}{diff && <>
      {diff.kind === 'untracked' && <p className="diff-note">未跟踪文件 · 当前内容预览</p>}
      {diff.truncated && <p className="diff-note">仅显示前 200KB 左右内容；完整文件未改动，可在编辑器查看。</p>}
      <pre className="diff-content" aria-label="文件差异">{diff.text.split('\n').map((line, index) => <span key={index} className={line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'addition' : line.startsWith('-') && !line.startsWith('---') ? 'deletion' : ''}>{line || ' '}{'\n'}</span>)}</pre>
    </>}</>}
    {!selected && files.length > 0 && <div className="git-empty"><h3>选择文件，查看真实差异</h3><p>检查后可将文件引用放入该会话的草稿，再给 Pi 具体反馈。</p></div>}
    {status && <div className="git-timestamp" title={status.root}>快照时间 {new Date(status.capturedAt).toLocaleTimeString()} · 手动刷新</div>}
  </aside>;
}

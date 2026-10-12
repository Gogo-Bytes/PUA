import { desktopClient } from '../../app/desktop-client';
import { useEffect, useRef, useState } from 'react';
import type { ChangedFile, DiffScope, FileDiff, GitBranchComparison, GitStatus } from '../../../shared/ipc/change-review';
import { filesForScope } from './scope';
import { referencePaths } from '../workspace';
import { Button, DiffView, Icon, IconButton, Tabs, Tooltip } from '../../ui';
import { CopyButton, LazyMarkdownView as MarkdownView, SourceView } from '../content';
import { isConflictPatch, parseDiffLines } from './diff-lines';

type Result = { diff: FileDiff; receivedAt: string } | { error: string };
const PAGE_SIZE = 5;
type ReviewMode = DiffScope | 'branch';

export function GitPanel(props: { sessionId: string; theme?: 'light' | 'dark'; onClose(): void; onReference(text: string): void }) {
  return <Review key={props.sessionId} {...props} />;
}

function Review({ sessionId, theme = 'light', onReference }: Parameters<typeof GitPanel>[0]) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [comparison, setComparison] = useState<GitBranchComparison | null>(null);
  const [comparisonError, setComparisonError] = useState('');
  const [scope, setScope] = useState<ReviewMode>('worktree');
  const [allExpanded, setAllExpanded] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = async () => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const [local, branch] = await Promise.allSettled([desktopClient.gitStatus(sessionId), desktopClient.gitBranchComparison(sessionId)]);
      if (generation.current !== request) return;
      if (local.status === 'rejected') throw local.reason;
      setStatus(local.value);
      setComparison(branch.status === 'fulfilled' ? branch.value : null);
      setComparisonError(branch.status === 'rejected' ? String(branch.reason) : '');
      setRevision(value => value + 1);
    } catch (error) {
      if (generation.current === request) {
        setStatus(null);
        setComparison(null);
        setComparisonError('');
        setError(String(error));
      }
    } finally {
      if (generation.current === request) setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [sessionId]);
  const files = scope === 'branch' ? (comparison?.files ?? []) : status ? filesForScope(status.files, scope) : [];
  const displayStatus =
    scope === 'branch' && comparison
      ? { root: comparison.root, branch: comparison.current, files: comparison.files, capturedAt: comparison.capturedAt }
      : status;
  return (
    <aside className="git-panel" aria-label="文件与 Git 检查区">
      <div className="review-toolbar">
        <div className="review-toolbar-branch" aria-label="分支比较">
          <span>{scope === 'branch' ? comparison?.current || '当前分支' : status?.branch || 'Git'}</span>
          <Icon name="forward" />
          <span>{scope === 'branch' ? comparison?.baseline || '参照分支' : scope === 'index' ? '暂存区' : '工作区'}</span>
        </div>
        <div className="review-scope" role="group" aria-label="变更范围">
          {(['worktree', 'index'] as const).map(value => (
            <Tooltip key={value} content={`查看${value === 'index' ? '暂存区' : '工作区'}变更`}>
            <Button
              variant="ghost"
              className={scope === value ? 'is-active' : ''}
              aria-label={`查看${value === 'index' ? '暂存区' : '工作区'}变更`}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              <Icon name={value === 'index' ? 'branch' : 'review'} />
            </Button>
            </Tooltip>
          ))}
          <Tooltip content="比较当前分支">
          <Button
            variant="ghost"
            className={scope === 'branch' ? 'is-active' : ''}
            aria-label="比较当前分支"
            aria-pressed={scope === 'branch'}
            onClick={() => setScope('branch')}
          >
            <Icon name="branch" />
          </Button>
          </Tooltip>
        </div>
        <Tooltip content={allExpanded ? '全部收起' : '全部展开'}>
          <IconButton
            icon={allExpanded ? 'down' : 'chevron'}
            label={allExpanded ? '全部收起文件' : '全部展开文件'}
            variant="ghost"
            onClick={() => setAllExpanded(value => !value)}
          />
        </Tooltip>
        <Tooltip content={busy ? '刷新中…' : '刷新'}>
        <IconButton icon="refresh" label={busy ? '刷新中…' : '刷新'} disabled={busy} variant="ghost" onClick={() => void refresh()} />
        </Tooltip>
      </div>
      <div className="inspector-scroll">
        {error && (
          <div className="git-empty" role="alert">
            <h3>暂时无法读取 Git</h3>
            <p>请确认启动目录位于 Git 仓库内。不会自动初始化仓库或更改文件。</p>
            <pre>{error}</pre>
          </div>
        )}
        {busy && !status && <p className="diff-note">读取变更…</p>}
        {scope === 'branch' && comparisonError && (
          <div className="git-empty" role="alert">
            <h3>无法比较当前分支</h3>
            <p>{comparisonError}</p>
          </div>
        )}
        {displayStatus && !files.length && (scope !== 'branch' || comparison) && (
          <div className="git-empty">
            <Icon name="check" />
            <h3>这个范围没有变更</h3>
            <p>
              {scope === 'branch'
                ? '当前分支相对参照分支的共同祖先没有新增提交变更。未提交改动请查看工作区或暂存区。'
                : '修改文件后刷新，或切换暂存范围。'}
            </p>
          </div>
        )}
        {displayStatus && files.length > 0 && (
          <ReviewFiles
            key={`${scope}:${revision}`}
            status={displayStatus}
            files={files}
            sessionId={sessionId}
            scope={scope}
            theme={theme}
            allExpanded={allExpanded}
            onReference={onReference}
          />
        )}
      </div>
    </aside>
  );
}

function ReviewFiles({
  status,
  files,
  sessionId,
  scope,
  theme,
  allExpanded,
  onReference,
}: {
  status: GitStatus;
  files: ChangedFile[];
  sessionId: string;
  scope: ReviewMode;
  theme: 'light' | 'dark';
  allExpanded: boolean;
  onReference(text: string): void;
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
        try {
          result = {
            diff:
              scope === 'branch'
                ? await desktopClient.gitBranchFileDiff(sessionId, file.path)
                : await desktopClient.fileDiff(sessionId, file.path, scope),
            receivedAt: new Date().toLocaleTimeString(),
          };
        } catch (error) {
          result = { error: String(error) };
        }
        if (cancelled) return;
        loaded.current.add(file.path);
        setResults(current => new Map(current).set(file.path, result));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return () => {
      cancelled = true;
    };
  }, [sessionId, scope, status, limit]);
  const visible = files.slice(0, limit);
  const loading = visible.some(file => !results.get(file.path));
  const [selectedPath, setSelectedPath] = useState(files[0]?.path);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(files.map(file => file.path)));
  useEffect(() => {
    setExpandedPaths(allExpanded ? new Set(files.map(file => file.path)) : new Set());
  }, [allExpanded, files]);
  useEffect(() => {
    setSelectedPath(current => (files.some(file => file.path === current) ? current : files[0]?.path));
  }, [files]);
  return (
    <div className="review-files" aria-label="变更文件">
      <div className="review-file-list">
        {visible.map(file => (
          <ReviewFile
            key={file.path}
            file={file}
            result={results.get(file.path)}
            selected={selectedPath === file.path}
            expanded={expandedPaths.has(file.path)}
            onSelect={() => setSelectedPath(file.path)}
            onToggle={() =>
              setExpandedPaths(current => {
                const next = new Set(current);
                next.has(file.path) ? next.delete(file.path) : next.add(file.path);
                return next;
              })
            }
            sessionId={sessionId}
            scope={scope}
            theme={theme}
            onReference={() =>
              onReference(`请检查这个文件的变更：${referencePaths([status.root.replace(/[\\/]$/, '') + '/' + file.path])}`)
            }
          />
        ))}
      </div>
      {limit < files.length && (
        <Button className="review-load-more" disabled={loading} onClick={() => setLimit(current => current + PAGE_SIZE)}>
          {loading ? '读取差异…' : `继续加载 ${Math.min(PAGE_SIZE, files.length - limit)} 个文件`} · 共 {files.length} 个
        </Button>
      )}
    </div>
  );
}

function ReviewFile({
  file,
  result,
  selected,
  expanded,
  onSelect,
  onToggle,
  onReference,
  sessionId,
  scope,
  theme,
}: {
  file: ChangedFile;
  result?: Result;
  selected: boolean;
  expanded: boolean;
  onSelect(): void;
  onToggle(): void;
  onReference(): void;
  sessionId: string;
  scope: ReviewMode;
  theme: 'light' | 'dark';
}) {
  const diff = result && 'diff' in result ? result.diff : null;
  const conflict = diff?.kind === 'diff' && isConflictPatch(diff.text, file);
  const rows = diff?.kind === 'diff' && !conflict ? parseDiffLines(diff.text) : [];
  const statusLabel = file.originalPath
    ? 'R'
    : file.index === '?' || file.worktree === '?'
      ? 'U'
      : file.index.includes('D') || file.worktree.includes('D')
        ? 'D'
        : 'M';
  return (
    <section className="review-file" aria-label={file.path}>
      <div className="review-file-heading" data-selected={selected || undefined}>
        <Button
          variant="ghost"
          aria-label={file.path}
          aria-expanded={expanded}
          onClick={() => {
            onSelect();
            onToggle();
          }}
          title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
        >
          <span className={`review-file-status review-file-status-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
          <Icon name="chevron" className={expanded ? 'is-expanded' : ''} />
          <span>{file.path}</span>
        </Button>
        {diff?.kind === 'diff' && !conflict && (
          <span className="review-count">
            <span className="addition-text">+{rows.filter(row => row.kind === 'addition').length}</span>{' '}
            <span className="deletion-text">−{rows.filter(row => row.kind === 'deletion').length}</span>
            {diff.truncated && <small>部分</small>}
          </span>
        )}
        <div className="review-file-actions">
          <IconButton icon="link" label="引用文件到草稿" variant="ghost" onClick={onReference} />
          {diff && <CopyButton text={diff.text} label={diff.kind === 'untracked' ? '复制文件快照' : '复制差异输出'} />}
        </div>
      </div>
      {expanded && <ReviewFileDetail file={file} result={result} sessionId={sessionId} scope={scope} theme={theme} />}
    </section>
  );
}

function ReviewFileDetail({
  file,
  result,
  sessionId,
  scope,
  theme,
}: {
  file: ChangedFile;
  result?: Result;
  sessionId: string;
  scope: ReviewMode;
  theme: 'light' | 'dark';
}) {
  const [view, setView] = useState<'source' | 'preview'>('source');
  const diff = result && 'diff' in result ? result.diff : null;
  const conflict = diff?.kind === 'diff' && isConflictPatch(diff.text, file);
  const markdown = diff?.kind === 'untracked' && /\.(md|markdown)$/i.test(file.path);
  return (
    <div className="review-diff-pane" aria-label={`文件差异：${file.path}`}>
      {!result && <p className="diff-note">读取差异…</p>}
      {result && 'error' in result && (
        <p role="alert" className="diff-note form-error">
          {result.error}
        </p>
      )}
      {diff && (
        <>
          <div className="review-file-meta">
            {conflict
              ? '冲突 · 原始 patch'
              : diff.kind === 'diff'
                ? scope === 'branch'
                  ? '共同祖先 → 当前分支 HEAD'
                  : scope === 'index'
                    ? 'HEAD → 暂存区'
                    : '暂存区 → 工作区'
                : diff.kind === 'untracked'
                  ? '工作区未跟踪文本快照'
                  : diff.kind === 'binary'
                    ? '二进制 · 无文本预览'
                    : '符号链接 · 不读取目标'}
          </div>
          {diff.truncated && (
            <p className="diff-note">
              内容已截断（约前 200KB）；{conflict ? '仅保留已返回的原始 patch。' : '计数仅涵盖已显示差异，不代表完整文件。'}
            </p>
          )}
          {markdown && (
            <Tabs
              label="文件视图"
              value={view}
              onChange={value => setView(value as 'source' | 'preview')}
              items={[
                { value: 'source', label: '源码' },
                { value: 'preview', label: '预览' },
              ]}
            />
          )}
          {conflict || (diff.kind === 'diff' && diff.truncated) ? (
            <pre className="diff-content" aria-label={conflict ? '原始冲突 patch' : '已截断 patch'}>
              {diff.text}
            </pre>
          ) : diff.kind === 'diff' ? (
            <DiffView
              text={diff.text}
              theme={theme}
              loadDiffFiles={scope === 'branch' ? undefined : () => desktopClient.fileDiffContents(sessionId, file.path, scope)}
            />
          ) : diff.kind === 'untracked' ? (
            markdown && view === 'preview' ? (
              <div className="document ui-chat-body">
                <MarkdownView text={diff.text} />
              </div>
            ) : (
              <SourceView text={diff.text} label="未跟踪文件源码快照" />
            )
          ) : (
            <p className="diff-note">{diff.text}</p>
          )}
        </>
      )}
    </div>
  );
}

import { Button, Icon, IconButton, Input } from '../../ui';
import type { EnvironmentCardView, EnvironmentIntent } from './environment-view';

/** Pure workspace presentation; every action is an explicit intent. */
export function EnvironmentCard({ view, onIntent }: { view: EnvironmentCardView; onIntent(intent: EnvironmentIntent): void }) {
  const {
    sessionAvailable,
    taskBusy,
    cwd,
    status,
    statusError,
    branches,
    worktrees,
    backgroundProcesses,
    showBranches,
    showWorktrees,
    newBranch,
    newWorktreeBranch,
    busy,
    branchError,
    worktreeError,
  } = view;
  const branchBusy = busy === 'branch';
  const worktreeBusy = busy === 'worktree';
  const structureDisabled = !!busy || taskBusy || status === undefined || status.fileCount > 0;
  const openPanel = (kind: 'review' | 'task') => onIntent({ type: 'open-panel', kind });
  return (
    <aside
      className="environment-panel"
      aria-label="环境与任务信息"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
        const target = event.target as Element;
        // Portal events bubble through React even after the Dialog has detached.
        if (
          !event.currentTarget.contains(target) ||
          target.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="menu"], [role="listbox"]')
        )
          return;
        event.preventDefault();
        onIntent({ type: 'close' });
      }}
    >
      <section className="environment-section">
        <div className="environment-heading">
          <span>Environment</span>
        </div>
        <Button variant="ghost" className="environment-row" disabled={!sessionAvailable} onClick={() => openPanel('review')}>
          <Icon name="review" />
          <span>Changes</span>
          <small>{status ? `${status.fileCount} 个文件` : !sessionAvailable ? '选择会话' : statusError ? '读取失败' : '读取中…'}</small>
        </Button>
        <div className="environment-row">
          <Icon name="local" />
          <span>Local</span>
          <small>本机</small>
        </div>
        <Button
          variant="ghost"
          className="environment-row"
          disabled={!sessionAvailable || !branches?.names.length}
          aria-expanded={showBranches}
          onClick={() => onIntent({ type: 'toggle-branches' })}
        >
          <Icon name="branch" />
          <span>{branches?.current || status?.branch || '分支'}</span>
          <small>{branchBusy ? '切换中…' : '本地分支'}</small>
          <Icon name="down" />
        </Button>
        {showBranches && (
          <div className="environment-branches" role="group" aria-label="本地分支">
            {branches?.names.map(branch => (
              <div key={branch} className="environment-branch-row">
                <Button
                  aria-current={branch === branches.current ? 'true' : undefined}
                  variant="ghost"
                  className="environment-branch-option"
                  disabled={structureDisabled}
                  onClick={() => onIntent({ type: 'switch-branch', branch })}
                >
                  <span>{branch}</span>
                  {branch === branches.current && <small>当前</small>}
                </Button>
                {branch !== branches.current && (
                  <IconButton
                    icon="close"
                    label={`删除分支 ${branch}`}
                    variant="ghost"
                    disabled={structureDisabled}
                    onClick={() => onIntent({ type: 'delete-branch', branch })}
                  />
                )}
              </div>
            ))}
            <form
              className="environment-branch-create"
              onSubmit={event => {
                event.preventDefault();
                onIntent({ type: 'create-branch' });
              }}
            >
              <Input
                aria-label="新分支名称"
                placeholder="新建分支…"
                maxLength={255}
                value={newBranch}
                disabled={structureDisabled}
                onChange={event => onIntent({ type: 'edit-branch', value: event.target.value })}
              />
              <Button type="submit" variant="ghost" disabled={!newBranch.trim() || structureDisabled}>
                {branchBusy ? '处理中…' : '创建并切换'}
              </Button>
            </form>
            {status && status.fileCount > 0 && <p className="environment-note">工作区有未提交改动；请先提交或收纳后再操作分支。</p>}
            {taskBusy && <p className="environment-note">任务执行期间不能操作分支。</p>}
            {branchError && (
              <p className="environment-note" role="alert">
                {branchError}
              </p>
            )}
          </div>
        )}
        {!branches && branchError && (
          <p className="environment-note" role="alert">
            无法读取本地分支：{branchError}
          </p>
        )}
        <Button
          variant="ghost"
          className="environment-row"
          disabled={!sessionAvailable || !worktrees?.length}
          aria-expanded={showWorktrees}
          onClick={() => onIntent({ type: 'toggle-worktrees' })}
        >
          <Icon name="folder" />
          <span>Worktrees</span>
          <small>
            {worktrees ? `${worktrees.length} 个工作树` : worktreeError ? '读取失败' : !sessionAvailable ? '选择会话' : '读取中…'}
          </small>
          <Icon name="down" />
        </Button>
        {showWorktrees && (
          <div className="environment-branches" role="group" aria-label="本地工作树">
            {worktrees?.map(item => (
              <div key={item.path} className="environment-branch-row">
                <div className="environment-worktree-option" title={item.path}>
                  <span>{item.branch || 'detached HEAD'}</span>
                  <small>
                    {item.current ? '当前 · ' : ''}
                    {item.path}
                  </small>
                </div>
                {!item.current && (
                  <IconButton
                    icon="close"
                    label={`移除工作树 ${item.path}`}
                    variant="ghost"
                    disabled={structureDisabled}
                    onClick={() => onIntent({ type: 'delete-worktree', path: item.path })}
                  />
                )}
              </div>
            ))}
            <form
              className="environment-branch-create"
              onSubmit={event => {
                event.preventDefault();
                onIntent({ type: 'create-worktree' });
              }}
            >
              <Input
                aria-label="新工作树分支名称"
                placeholder="从新分支创建工作树…"
                maxLength={255}
                value={newWorktreeBranch}
                disabled={structureDisabled}
                onChange={event => onIntent({ type: 'edit-worktree', value: event.target.value })}
              />
              <Button type="submit" variant="ghost" disabled={!newWorktreeBranch.trim() || structureDisabled}>
                {worktreeBusy ? '处理中…' : '创建工作树'}
              </Button>
            </form>
            {status && status.fileCount > 0 && <p className="environment-note">工作区有未提交改动；请先提交或收纳后再操作工作树。</p>}
            {taskBusy && <p className="environment-note">任务执行期间不能操作工作树。</p>}
            {worktreeError && (
              <p className="environment-note" role="alert">
                {worktreeError}
              </p>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          className="environment-row"
          disabled={!sessionAvailable || !status || taskBusy || !!busy}
          onClick={() => onIntent({ type: 'open-commit' })}
        >
          <Icon name="branch" />
          <span>Commit or push</span>
          <small>{status?.fileCount ? `${status.fileCount} 个文件待提交` : '推送当前分支'}</small>
        </Button>
        {statusError && (
          <p className="environment-note" role="alert">
            {statusError}
          </p>
        )}
        {(statusError || branchError || worktreeError) && (
          <Button variant="ghost" disabled={!!busy} onClick={() => onIntent({ type: 'retry-read' })}>
            重试读取
          </Button>
        )}
      </section>
      {backgroundProcesses.length > 0 && (
        <section className="environment-section">
          <div className="environment-heading">Background processes</div>
          {backgroundProcesses.map(item => (
            <Button
              key={item.id}
              variant="ghost"
              className="environment-row environment-process-row"
              onClick={() => onIntent({ type: 'select-session', id: item.id })}
            >
              <Icon name="terminal" />
              <span>{item.title}</span>
              <small>{item.activityLabel}</small>
            </Button>
          ))}
        </section>
      )}
      {cwd && (
        <section className="environment-section">
          <div className="environment-heading">
            <span>Sources</span>
          </div>
          <div className="environment-row" title={cwd}>
            <Icon name="folder" />
            <span>{cwd}</span>
          </div>
          <Button variant="ghost" className="environment-row" disabled={!sessionAvailable} onClick={() => openPanel('task')}>
            <Icon name="info" />
            <span>任务详情</span>
            <Icon name="chevron" />
          </Button>
        </section>
      )}
    </aside>
  );
}

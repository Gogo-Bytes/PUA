import { useEffect, useState, type FormEvent } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import type { GitStatus } from '../../../shared/ipc/change-review';
import { desktopClient } from '../../app/desktop-client';
import { Button, Dialog, Icon, IconButton, Input, Popover } from '../../ui';
import type { SidePanelKind } from './useSidePanelTabs';

export function EnvironmentPopover({ session, onOpenPanel }: {
  session?: SessionInfo; onOpenPanel(kind: SidePanelKind): void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ id: string; status?: GitStatus; error?: string }>();
  const [branchState, setBranchState] = useState<{ id: string; current: string; branches: string[] }>();
  const [showBranches, setShowBranches] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string>();
  const [newBranch, setNewBranch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const [worktreeState, setWorktreeState] = useState<{ id: string; current: string; worktrees: import('../../../shared/ipc/change-review').GitWorktree[] }>();
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string>();
  const [newWorktreeBranch, setNewWorktreeBranch] = useState('');
  const [deleteWorktreeTarget, setDeleteWorktreeTarget] = useState<string>();
  useEffect(() => {
    if (!open || !session) return;
    let current = true;
    setSnapshot(undefined); setBranchState(undefined); setShowBranches(false); setBranchError(undefined); setNewBranch(''); setDeleteTarget(undefined); setWorktreeState(undefined); setShowWorktrees(false); setWorktreeError(undefined); setNewWorktreeBranch(''); setDeleteWorktreeTarget(undefined);
    void desktopClient.gitStatus(session.id).then(status => {
      if (current) setSnapshot({ id: session.id, status });
    }).catch(error => { if (current) setSnapshot({ id: session.id, error: String(error) }); });
    void desktopClient.gitBranches(session.id).then(value => {
      if (current) setBranchState({ id: session.id, ...value });
    }).catch(error => { if (current) setBranchError(String(error)); });
    void desktopClient.gitWorktrees(session.id).then(value => {
      if (current) setWorktreeState({ id: session.id, ...value });
    }).catch(error => { if (current) setWorktreeError(String(error)); });
    return () => { current = false; };
  }, [open, session?.id]);
  const status = snapshot?.id === session?.id ? snapshot?.status : undefined;
  const branches = branchState?.id === session?.id ? branchState : undefined;
  const worktrees = worktreeState?.id === session?.id ? worktreeState : undefined;
  const taskBusy = !!session && (session.kind === 'terminal' || session.activity !== 'idle');
  const openPanel = (kind: SidePanelKind) => { setOpen(false); onOpenPanel(kind); };
  const switchBranch = async (branch: string) => {
    if (!session || branch === branches?.current || branchBusy) return;
    setBranchBusy(true); setBranchError(undefined);
    try {
      const next = await desktopClient.switchGitBranch(session.id, branch);
      const nextBranches = await desktopClient.gitBranches(session.id);
      setSnapshot({ id: session.id, status: next });
      setBranchState({ id: session.id, ...nextBranches });
      setShowBranches(false);
    } catch (error) { setBranchError(String(error)); }
    finally { setBranchBusy(false); }
  };
  const createBranch = async (event: FormEvent) => {
    event.preventDefault();
    const name = newBranch.trim();
    if (!session || !name || branchBusy) return;
    setBranchBusy(true); setBranchError(undefined);
    try {
      const next = await desktopClient.createGitBranch(session.id, name);
      const nextBranches = await desktopClient.gitBranches(session.id);
      setSnapshot({ id: session.id, status: next }); setBranchState({ id: session.id, ...nextBranches }); setNewBranch('');
    } catch (error) { setBranchError(String(error)); }
    finally { setBranchBusy(false); }
  };
  const deleteBranch = async () => {
    if (!session || !deleteTarget || branchBusy) return;
    const name = deleteTarget;
    setBranchBusy(true); setBranchError(undefined);
    try {
      const nextBranches = await desktopClient.deleteGitBranch(session.id, name);
      setBranchState({ id: session.id, ...nextBranches }); setDeleteTarget(undefined);
    } catch (error) { setBranchError(String(error)); }
    finally { setBranchBusy(false); }
  };
  const createWorktree = async (event: FormEvent) => {
    event.preventDefault();
    const name = newWorktreeBranch.trim();
    if (!session || !name || worktreeBusy) return;
    setWorktreeBusy(true); setWorktreeError(undefined);
    try {
      const next = await desktopClient.createGitWorktree(session.id, name);
      setWorktreeState({ id: session.id, ...next }); setNewWorktreeBranch('');
    } catch (error) { setWorktreeError(String(error)); }
    finally { setWorktreeBusy(false); }
  };
  const deleteWorktree = async () => {
    if (!session || !deleteWorktreeTarget || worktreeBusy) return;
    setWorktreeBusy(true); setWorktreeError(undefined);
    try {
      const next = await desktopClient.deleteGitWorktree(session.id, deleteWorktreeTarget);
      setWorktreeState({ id: session.id, ...next }); setDeleteWorktreeTarget(undefined);
    } catch (error) { setWorktreeError(String(error)); }
    finally { setWorktreeBusy(false); }
  };
  return <Popover label="环境与任务信息" icon="environment" open={open} onOpenChange={setOpen} className="environment-popover">
    <section className="environment-section">
      <div className="environment-heading"><span>Environment</span><IconButton icon="plus" label="添加环境（未接入）" disabled variant="ghost"/></div>
      <Button variant="ghost" className="environment-row" disabled={!session} onClick={() => openPanel('review')}>
        <Icon name="review"/><span>Changes</span><small>{status ? `${status.files.length} 个文件` : !session ? '选择会话' : snapshot?.error ? '读取失败' : '读取中…'}</small>
      </Button>
      <div className="environment-row"><Icon name="local"/><span>Local</span><small>本机</small></div>
      <Button variant="ghost" className="environment-row" disabled={!session || !branches?.branches.length} aria-expanded={showBranches} onClick={() => setShowBranches(value => !value)}>
        <Icon name="branch"/><span>{branches?.current || status?.branch || '分支'}</span><small>{branchBusy ? '切换中…' : '本地分支'}</small><Icon name="down"/>
      </Button>
      {showBranches && <div className="environment-branches" role="group" aria-label="本地分支">
        {branches?.branches.map(branch => <div key={branch} className="environment-branch-row">
          <Button aria-current={branch === branches.current ? 'true' : undefined} variant="ghost" className="environment-branch-option" disabled={branchBusy || taskBusy || status === undefined || status.files.length > 0} onClick={() => void switchBranch(branch)}>
            <span>{branch}</span>{branch === branches.current && <small>当前</small>}
          </Button>
          {branch !== branches.current && <IconButton icon="close" label={`删除分支 ${branch}`} variant="ghost" disabled={branchBusy || taskBusy || status === undefined || status.files.length > 0} onClick={() => setDeleteTarget(branch)}/>}
        </div>)}
        <form className="environment-branch-create" onSubmit={event => void createBranch(event)}>
          <Input aria-label="新分支名称" placeholder="新建分支…" maxLength={255} value={newBranch} disabled={branchBusy || taskBusy || status === undefined || status.files.length > 0} onChange={event => setNewBranch(event.target.value)}/>
          <Button type="submit" variant="ghost" disabled={!newBranch.trim() || branchBusy || taskBusy || status === undefined || status.files.length > 0}>{branchBusy ? '处理中…' : '创建并切换'}</Button>
        </form>
        {status && status.files.length > 0 && <p className="environment-note">工作区有未提交改动；请先提交或收纳后再操作分支。</p>}
        {taskBusy && <p className="environment-note">任务执行期间不能操作分支。</p>}
        {branchError && <p className="environment-note" role="alert">{branchError}</p>}
      </div>}
      {!branches && branchError && <p className="environment-note" role="alert">无法读取本地分支：{branchError}</p>}
      <Button variant="ghost" className="environment-row" disabled={!session || !worktrees?.worktrees.length} aria-expanded={showWorktrees} onClick={() => setShowWorktrees(value => !value)}>
        <Icon name="folder"/><span>Worktrees</span><small>{worktrees ? `${worktrees.worktrees.length} 个工作树` : worktreeError ? '读取失败' : '读取中…'}</small><Icon name="down"/>
      </Button>
      {showWorktrees && <div className="environment-branches" role="group" aria-label="本地工作树">
        {worktrees?.worktrees.map(item => <div key={item.path} className="environment-branch-row">
          <div className="environment-worktree-option" title={item.path}><span>{item.branch || 'detached HEAD'}</span><small>{item.current ? '当前 · ' : ''}{item.path}</small></div>
          {!item.current && <IconButton icon="close" label={`移除工作树 ${item.path}`} variant="ghost" disabled={worktreeBusy || taskBusy || status === undefined || status.files.length > 0} onClick={() => setDeleteWorktreeTarget(item.path)}/>}
        </div>)}
        <form className="environment-branch-create" onSubmit={event => void createWorktree(event)}>
          <Input aria-label="新工作树分支名称" placeholder="从新分支创建工作树…" maxLength={255} value={newWorktreeBranch} disabled={worktreeBusy || taskBusy || status === undefined || status.files.length > 0} onChange={event => setNewWorktreeBranch(event.target.value)}/>
          <Button type="submit" variant="ghost" disabled={!newWorktreeBranch.trim() || worktreeBusy || taskBusy || status === undefined || status.files.length > 0}>{worktreeBusy ? '处理中…' : '创建工作树'}</Button>
        </form>
        {status && status.files.length > 0 && <p className="environment-note">工作区有未提交改动；请先提交或收纳后再操作工作树。</p>}
        {taskBusy && <p className="environment-note">任务执行期间不能操作工作树。</p>}
        {worktreeError && <p className="environment-note" role="alert">{worktreeError}</p>}
      </div>}
      <Button variant="ghost" className="environment-row" disabled><Icon name="branch"/><span>Commit or push</span><small>未接入</small></Button>
      {snapshot?.id === session?.id && snapshot?.error && <p className="environment-note">暂时无法读取仓库；可打开 Review 查看错误并重试。</p>}
    </section>
    <section className="environment-section"><div className="environment-heading">Subagents</div>
      <div className="environment-row is-unavailable"><Icon name="agents"/><span>子代理任务</span><small>未接入</small></div>
    </section>
    <section className="environment-section"><div className="environment-heading">Background processes</div>
      <div className="environment-row is-unavailable"><Icon name="terminal"/><span>后台进程</span><small>未接入</small></div>
    </section>
    <section className="environment-section"><div className="environment-heading"><span>Sources</span><IconButton icon="plus" label="添加来源（未接入）" disabled variant="ghost"/></div>
      <div className="environment-row" title={session?.cwd}><Icon name="folder"/><span>{session?.cwd || '尚未选择会话'}</span></div>
      <Button variant="ghost" className="environment-row" disabled={!session} onClick={() => openPanel('task')}><Icon name="info"/><span>任务详情</span><Icon name="chevron"/></Button>
    </section>
    <Dialog open={!!deleteTarget} title="删除本地分支？" closeLabel="取消" closeDisabled={branchBusy} closeOnBackdrop={!branchBusy} onClose={() => setDeleteTarget(undefined)}>
      <p>将尝试安全删除 <strong>{deleteTarget}</strong>。如果分支包含尚未合并的提交，Git 会拒绝删除；不会强制删除。</p>
      {branchError && <p className="form-error" role="alert">{branchError}</p>}
      <div className="modal-actions"><Button disabled={branchBusy} onClick={() => setDeleteTarget(undefined)}>取消</Button><Button variant="primary" busy={branchBusy} onClick={() => void deleteBranch()}>删除分支</Button></div>
    </Dialog>
    <Dialog open={!!deleteWorktreeTarget} title="移除工作树？" closeLabel="取消" closeDisabled={worktreeBusy} closeOnBackdrop={!worktreeBusy} onClose={() => setDeleteWorktreeTarget(undefined)}>
      <p>将尝试移除 <strong>{deleteWorktreeTarget}</strong>。只有干净的非当前工作树可以移除，不会强制删除未提交文件。</p>
      {worktreeError && <p className="form-error" role="alert">{worktreeError}</p>}
      <div className="modal-actions"><Button disabled={worktreeBusy} onClick={() => setDeleteWorktreeTarget(undefined)}>取消</Button><Button variant="primary" busy={worktreeBusy} onClick={() => void deleteWorktree()}>移除工作树</Button></div>
    </Dialog>
  </Popover>;
}

import { useEffect, useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import type { GitStatus } from '../../../shared/ipc/change-review';
import { desktopClient } from '../../app/desktop-client';
import { Button, Icon, IconButton, Popover } from '../../ui';
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
  useEffect(() => {
    if (!open || !session) return;
    let current = true;
    setSnapshot(undefined); setBranchState(undefined); setShowBranches(false); setBranchError(undefined);
    void desktopClient.gitStatus(session.id).then(status => {
      if (current) setSnapshot({ id: session.id, status });
    }).catch(error => { if (current) setSnapshot({ id: session.id, error: String(error) }); });
    void desktopClient.gitBranches(session.id).then(value => {
      if (current) setBranchState({ id: session.id, ...value });
    }).catch(error => { if (current) setBranchError(String(error)); });
    return () => { current = false; };
  }, [open, session?.id]);
  const status = snapshot?.id === session?.id ? snapshot?.status : undefined;
  const branches = branchState?.id === session?.id ? branchState : undefined;
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
      {showBranches && <div className="environment-branches" role="listbox" aria-label="本地分支">
        {branches?.branches.map(branch => <Button key={branch} role="option" aria-selected={branch === branches.current} variant="ghost" className="environment-branch-option" disabled={branchBusy || taskBusy || status === undefined || status.files.length > 0} onClick={() => void switchBranch(branch)}>
          <span>{branch}</span>{branch === branches.current && <small>当前</small>}
        </Button>)}
        {status && status.files.length > 0 && <p className="environment-note">工作区有未提交改动；请先提交或收纳后再切换分支。</p>}
        {taskBusy && <p className="environment-note">任务执行期间不能切换分支。</p>}
        {branchError && <p className="environment-note" role="alert">{branchError}</p>}
      </div>}
      {!branches && branchError && <p className="environment-note" role="alert">无法读取本地分支：{branchError}</p>}
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
  </Popover>;
}

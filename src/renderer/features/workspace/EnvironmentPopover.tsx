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
  useEffect(() => {
    if (!open || !session) return;
    let current = true;
    setSnapshot(undefined);
    void desktopClient.gitStatus(session.id).then(status => {
      if (current) setSnapshot({ id: session.id, status });
    }).catch(error => { if (current) setSnapshot({ id: session.id, error: String(error) }); });
    return () => { current = false; };
  }, [open, session?.id]);
  const status = snapshot?.id === session?.id ? snapshot?.status : undefined;
  const openPanel = (kind: SidePanelKind) => { setOpen(false); onOpenPanel(kind); };
  return <Popover label="环境与任务信息" icon="environment" open={open} onOpenChange={setOpen} className="environment-popover">
    <section className="environment-section">
      <div className="environment-heading"><span>Environment</span><IconButton icon="plus" label="添加环境（未接入）" disabled variant="ghost"/></div>
      <Button variant="ghost" className="environment-row" disabled={!session} onClick={() => openPanel('review')}>
        <Icon name="review"/><span>Changes</span><small>{status ? `${status.files.length} 个文件` : !session ? '选择会话' : snapshot?.error ? '读取失败' : '读取中…'}</small>
      </Button>
      <div className="environment-row"><Icon name="local"/><span>Local</span><small>本机</small></div>
      <Button variant="ghost" className="environment-row" disabled title="分支切换、创建与 worktree 操作尚未接入">
        <Icon name="branch"/><span>{status?.branch || '分支'}</span><small>操作未接入</small><Icon name="down"/>
      </Button>
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

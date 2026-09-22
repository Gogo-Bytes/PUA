import { useEffect, useRef, useState } from 'react';
import { useOverlayContainer } from '../../ui/theme';
import { MenuRoot, MenuTrigger, MenuContent, MenuRadioGroup, MenuRadioItem } from '../../ui/shadcn-menu';
import { Button, Icon, IconButton, InlineRename, type InlineRenameLabels } from '../../ui';

export interface WorkspaceSessionTab {
  id: string;
  title: string;
  kind?: 'chat' | 'terminal';
  processStatus?: 'starting' | 'running' | 'exited';
  activity?: 'idle' | 'responding' | 'compacting' | 'retrying' | 'waiting-input';
}
export interface SessionTabsLabels {
  title: string;
  add: string;
  all: string;
  menu: string;
  close(title: string): string;
  rename: Partial<InlineRenameLabels>;
}
export interface SessionTabsProps {
  sessions: readonly WorkspaceSessionTab[];
  activeId: string | null;
  onSelect(id: string): void;
  onClose?(id: string): void;
  onRename?(id: string, title: string): void | Promise<void>;
  onAdd?(): void;
  addDisabled?: boolean;
  showOverflow?: boolean;
  groupKey?: string;
  labels?: Partial<SessionTabsLabels>;
}

export function SessionTabs({ sessions, activeId, onSelect, onClose, onRename, onAdd, addDisabled, showOverflow = false, groupKey, labels }: SessionTabsProps) {
  const text = { title: 'Sessions', add: 'Add session', all: 'All sessions', menu: 'All sessions', close: (title: string) => `Close ${title}`, rename: {}, ...labels };
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useOverlayContainer();
  const tablist = useRef<HTMLDivElement>(null);
  const targets = useRef(new Map<string, HTMLDivElement>());
  const revealActiveTab = () => tablist.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  useEffect(() => { revealActiveTab(); }, [activeId]);
  useEffect(() => setMenu(false), [groupKey]);
  return <section className="ui-session-strip" aria-label={text.title} data-workspace-task-list="true">
    <div ref={tablist} role="tablist" aria-label={text.title} className="ui-session-tabs" onKeyDown={event => {
      const source = event.target as HTMLElement;
      if (source.getAttribute('role') !== 'tab') return;
      const index = sessions.findIndex(session => targets.current.get(session.id)?.contains(source));
      const next = event.key === 'ArrowRight' ? (index + 1) % sessions.length : event.key === 'ArrowLeft' ? (index - 1 + sessions.length) % sessions.length : event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1 : -1;
      if (next < 0 || !sessions[next]) return;
      event.preventDefault(); onSelect(sessions[next].id);
      const target = targets.current.get(sessions[next].id);
      (target?.querySelector<HTMLElement>('[role="tab"], input:not(:disabled)') ?? target?.querySelector<HTMLElement>('.ui-rename-editor'))?.focus();
    }}>{sessions.map(session => <div className="ui-session-tab" key={session.id} ref={node => { if (node) targets.current.set(session.id, node); else targets.current.delete(session.id); }}>
      {onRename ? <InlineRename labels={{ ...text.rename, hint: `${sessionDescription(session)} · ${text.rename.hint ?? 'Double-click or F2 to rename'}` }} value={session.title} selected={activeId === session.id} onSelect={() => onSelect(session.id)} onRename={title => onRename(session.id, title)}/> : <Button role="tab" variant="ghost" aria-selected={session.id === activeId} tabIndex={session.id === activeId ? 0 : -1} title={sessionDescription(session)} onClick={() => onSelect(session.id)}><Icon name="chat"/><span>{session.title}</span>{session.activity && session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="ui-session-activity"/>}</Button>}
      {onRename && session.activity && session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="ui-session-activity" aria-hidden="true"/>}{onClose && <IconButton className="ui-session-close" label={text.close(session.title)} icon="close" variant="ghost" onClick={() => onClose(session.id)}/>}
    </div>)}</div>
    {onAdd && <IconButton icon="plus" label={text.add} disabled={addDisabled} variant="ghost" onClick={onAdd}/>}
    {showOverflow && <div className="ui-session-overflow"><MenuRoot open={menu} onOpenChange={setMenu}>
      <MenuTrigger render={<IconButton ref={trigger} icon="down" label={text.all} variant="ghost"/>} disabled={!sessions.length}/>
      <MenuContent container={container} aria-label={text.menu}>
        <MenuRadioGroup value={activeId ?? ''} onValueChange={id => { onSelect(id); setMenu(false); }}>
          {sessions.map(session => <MenuRadioItem key={session.id} value={session.id} onClick={() => { if (session.id === activeId) revealActiveTab(); }}><Icon name={session.kind === 'terminal' ? 'terminal' : 'chat'}/><span>{session.title}</span>{session.id === activeId && <Icon name="check"/>}</MenuRadioItem>)}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot></div>}
  </section>;
}

function sessionDescription(session: WorkspaceSessionTab): string {
  const kind = session.kind === 'terminal' ? '兼容终端' : '对话';
  const status = session.processStatus === 'starting' ? '连接中' : session.processStatus === 'exited' ? '已退出' : session.activity === 'idle' ? '就绪' : '处理中';
  return `${session.title} · ${kind} · ${status}`;
}

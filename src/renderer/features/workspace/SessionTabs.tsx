import { useEffect, useRef, useState } from 'react';
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
  showOverflow?: boolean;
  groupKey?: string;
  labels?: Partial<SessionTabsLabels>;
}

export function SessionTabs({ sessions, activeId, onSelect, onClose, onRename, onAdd, showOverflow = false, groupKey, labels }: SessionTabsProps) {
  const text = { title: 'Sessions', add: 'Add session', all: 'All sessions', menu: 'All sessions', close: (title: string) => `Close ${title}`, rename: {}, ...labels };
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const tablist = useRef<HTMLDivElement>(null);
  const targets = useRef(new Map<string, HTMLDivElement>());
  const revealActiveTab = () => tablist.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  useEffect(() => { revealActiveTab(); }, [activeId]);
  const closeMenu = () => { setMenu(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!menu) return;
    popup.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) closeMenu(); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menu]);
  useEffect(() => setMenu(false), [groupKey]);
  return <div className="ui-session-strip">
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
      {onRename ? <InlineRename labels={text.rename} value={session.title} selected={activeId === session.id} onSelect={() => onSelect(session.id)} onRename={title => onRename(session.id, title)}/> : <Button role="tab" variant="ghost" aria-selected={session.id === activeId} tabIndex={session.id === activeId ? 0 : -1} title={sessionDescription(session)} onClick={() => onSelect(session.id)}><Icon name="chat"/><span>{session.title}</span>{session.activity && session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="ui-session-activity"/>}</Button>}
      {onClose && <IconButton className="ui-session-close" label={text.close(session.title)} icon="close" variant="ghost" onClick={() => onClose(session.id)}/>}
    </div>)}</div>
    {onAdd && <IconButton icon="plus" label={text.add} variant="ghost" onClick={onAdd}/>}
    {showOverflow && <div className="ui-session-overflow"><IconButton ref={trigger} icon="down" label={text.all} variant="ghost" disabled={!sessions.length} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}/>{menu && <div className="ui-popup ui-session-menu" ref={popup} role="menu" aria-label={text.menu} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); closeMenu(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>{sessions.map(session => <Button variant="ghost" key={session.id} role="menuitemradio" aria-checked={session.id === activeId} onClick={() => { if (session.id === activeId) revealActiveTab(); onSelect(session.id); closeMenu(); }}><Icon name="chat"/><span>{session.title}</span>{session.id === activeId && <Icon name="check"/>}</Button>)}</div>}</div>}
  </div>;
}

function sessionDescription(session: WorkspaceSessionTab): string {
  const kind = session.kind === 'terminal' ? '兼容终端' : '对话';
  const status = session.processStatus === 'starting' ? '连接中' : session.processStatus === 'exited' ? '已退出' : session.activity === 'idle' ? '就绪' : '处理中';
  return `${session.title} · ${kind} · ${status}`;
}

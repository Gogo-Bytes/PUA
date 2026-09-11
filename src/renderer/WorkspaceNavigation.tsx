import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../shared/ipc/desktop-api';
import { Icon } from './Icon';
import { groupProjects } from './features/workspace';

export function ProjectNavigation({ sessions, recentProjects, project, onSelect }: { sessions: SessionInfo[]; recentProjects: string[]; project?: string; onSelect(cwd: string): void }) {
  const [query, setQuery] = useState('');
  const projects = groupProjects(sessions, recentProjects);
  return <><div className="section-heading">项目 <span>{projects.length}</span></div>{projects.length > 0 && <input className="session-filter" aria-label="筛选项目" placeholder="查找项目…" value={query} onChange={event => setQuery(event.target.value)} />}<nav className="projects" aria-label="项目">{projects.filter(item => item.cwd.toLowerCase().includes(query.toLowerCase())).map(item => <button key={item.cwd} className="project" aria-pressed={project === item.cwd} title={item.cwd} onClick={() => onSelect(item.cwd)}><Icon name="folder" /><span className="project-label">{item.name}<small>{item.cwd}</small></span><span className="count">{item.sessions.length}</span></button>)}</nav></>;
}

export function SessionTabs({ sessions, activeId, onSelect, onClose }: { sessions: SessionInfo[]; activeId: string | null; onSelect(id: string): void; onClose(id: string): void }) {
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const tablist = useRef<HTMLElement>(null);
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
  useEffect(() => setMenu(false), [sessions[0]?.cwd]);
  return <><nav ref={tablist} className="session-tabs" role="tablist" aria-label="项目会话" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
    event.preventDefault();
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next?.click(); next?.focus();
  }}>{sessions.map(session => <div className={`session-tab ${session.id === activeId ? 'selected' : ''}`} key={session.id}><button role="tab" aria-selected={session.id === activeId} tabIndex={session.id === activeId ? 0 : -1} title={`${session.title} · ${session.kind === 'terminal' ? '兼容终端' : '对话'} · ${session.processStatus === 'starting' ? '连接中' : session.processStatus === 'exited' ? '已退出' : session.activity === 'idle' ? '就绪' : '处理中'}`} onClick={() => onSelect(session.id)}><Icon name="chat" /><span>{session.title}</span>{session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="status-dot busy" />}</button><button className="close-session icon-button" aria-label={`关闭 ${session.title}`} onClick={() => onClose(session.id)}><Icon name="close" /></button></div>)}</nav><div className="session-overflow"><button ref={trigger} className="icon-button" disabled={!sessions.length} aria-label="全部会话" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(value => !value)}><Icon name="down" /></button>{menu && <div className="menu" ref={popup} role="menu" aria-label="当前项目全部会话" onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); closeMenu(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>{sessions.map(session => <button key={session.id} role="menuitemradio" aria-checked={session.id === activeId} onClick={() => { if (session.id === activeId) revealActiveTab(); onSelect(session.id); closeMenu(); }}><Icon name="chat" /><span>{session.title}</span>{session.id === activeId && <Icon name="check" />}</button>)}</div>}</div></>;
}

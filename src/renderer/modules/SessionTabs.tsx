import { useRef } from 'react';
import { IconButton, InlineRename, type InlineRenameLabels } from '../ui';
export type Session = { id: string; title: string };
export interface SessionTabsLabels { title: string; add: string; rename: Partial<InlineRenameLabels> }
export function SessionTabs({ sessions, selectedId, onSelect, onRename, onAdd, labels }: { sessions: Session[]; selectedId: string; onSelect(id: string): void; onRename(id: string, title: string): void | Promise<void>; onAdd(): void; labels?: Partial<SessionTabsLabels> }) {
  const text = { title: 'Sessions', add: 'Add session', ...labels };
  const targets = useRef(new Map<string, HTMLDivElement>());
  return <div className="ui-session-strip"><div role="tablist" aria-label={text.title} className="ui-session-tabs" onKeyDown={event => {
    const source = event.target as HTMLElement;
    if (source.getAttribute('role') !== 'tab') return;
    const index = sessions.findIndex(session => targets.current.get(session.id)?.contains(source));
    const next = event.key === 'ArrowRight' ? (index + 1) % sessions.length : event.key === 'ArrowLeft' ? (index - 1 + sessions.length) % sessions.length : event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1 : -1;
    if (next < 0 || !sessions[next]) return; event.preventDefault(); onSelect(sessions[next].id);
    const target = targets.current.get(sessions[next].id);
    (target?.querySelector<HTMLElement>('[role="tab"], input:not(:disabled)') ?? target?.querySelector<HTMLElement>('.ui-rename-editor'))?.focus();
  }}>{sessions.map(session => <InlineRename labels={text.rename} key={session.id} ref={node => { if (node) targets.current.set(session.id, node); else targets.current.delete(session.id); }} value={session.title} selected={selectedId === session.id} onSelect={() => onSelect(session.id)} onRename={title => onRename(session.id, title)}/>)}</div><IconButton icon="plus" label={text.add} variant="ghost" onClick={onAdd}/></div>;
}

import { useState } from 'react';
import { Sidebar, UIProvider, type SidebarProject, type SidebarSession } from '@pua/components';
import '@pua/components/styles.css';

const projects: readonly SidebarProject[] = [{ id: 'workspace:docs', title: 'Documentation', sessionIds: ['conversation:review'] }];
const initialSessions: readonly SidebarSession[] = [{
  id: 'conversation:review', title: 'Review onboarding', unread: true, canPin: true,
  presentation: { execution: { state: 'working' }, environment: { kind: 'cloud' } },
  menu: [{ type: 'action', id: 'archive', label: 'Request archive', icon: 'archive' }],
}];

/** Built-package consumer: replace owner callbacks with application commands, not host DTOs. */
export function Production() {
  const [expanded, setExpanded] = useState<readonly string[]>(['workspace:docs']);
  const [selected, setSelected] = useState<string | null>(null);
  const [sessions, setSessions] = useState(initialSessions);
  const [intent, setIntent] = useState('Business actions are placeholders; no backend is connected.');
  return <UIProvider theme="light"><main style={{ display: 'flex', height: '100vh' }}>
    <aside style={{ width: 320 }}><Sidebar projects={projects} sessions={sessions} recentSessionIds={[]}
      expandedProjectIds={expanded} selectedSessionId={selected}
      onProjectExpandedChange={(id, next) => setExpanded(ids => next ? [...new Set([...ids, id])] : ids.filter(value => value !== id))}
      onSelectSession={setSelected}
      onPinSession={(id, next) => setSessions(items => items.map(item => item.id === id ? { ...item, pinned: next } : item))}
      onSessionMenuAction={(id, action) => setIntent(`Owner command placeholder: ${action} → ${id}. Confirmation, cancellation and removal are not implemented here.`)} /></aside>
    <section style={{ padding: 24 }}><a href="/">← State gallery</a><h1>Production consumption seam</h1>
      <p>Selection: {selected ?? 'none'}</p><p role="status">{intent}</p>
      <p>Only public package imports, semantic UI data and owner callbacks. This is not a backend integration.</p></section>
  </main></UIProvider>;
}

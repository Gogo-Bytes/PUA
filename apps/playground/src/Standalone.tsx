import { useState } from 'react';
import { ProjectMenu, ProjectRow, SessionActions, SessionMenu, SessionRow, UIProvider, type SidebarSession } from '@pua/components';

/** Consumption examples intentionally import only the public package entry. */
export function Standalone() {
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(false);
  const [last, setLast] = useState('尚无操作');
  const session: SidebarSession = { id: 'standalone-session', title: '独立会话', canPin: true, pinned, primaryAction: { id: 'archive', label: '归档聊天', kind: 'archive' } };
  return <UIProvider className="lab-theme"><main className="lab-isolated">
    <a href="/">← 返回完整 Sidebar</a><h1>独立组件样本</h1><p>这些组件不在 Sidebar 内部，各自管理局部 pending / error。</p>
    <section><h2>SessionActions</h2><SessionActions session={session} onPin={next => { setPinned(next); setLast(`pin=${next}`); }}
      onPrimaryAction={() => Promise.reject(new Error('独立操作失败反馈'))} /></section>
    <section><h2>SessionRow</h2><SessionRow session={{ ...session, id: 'standalone-row', menu: [{ type: 'action', id: 'custom', label: '示例操作', icon: 'read' }] }} selected={selected}
      onSelect={() => setSelected(value => !value)} onPin={next => setPinned(next)} onPrimaryAction={() => setLast('归档意图')} onMenuAction={id => setLast(`row action=${id}`)} />
      <SessionRow session={{ ...session, id: 'retained-row', title: '保留归档的会话', retainArchiveAction: true, menu: [{ type: 'action', id: 'custom', label: '示例操作' }] }}
        onSelect={() => setLast('选择保留归档会话')} onPin={next => setPinned(next)} onPrimaryAction={() => setLast('保留归档意图')} onMenuAction={id => setLast(`retained action=${id}`)} /></section>
    <section><h2>ProjectRow</h2><ProjectRow project={{ id: 'standalone-project', title: '独立项目' }} expanded={expanded}
      onExpandedChange={setExpanded} onSelect={() => setLast('选择项目')} onNewSession={() => setLast('新建意图')} /></section>
    <section className="lab-isolated-menus"><div><h2>ProjectMenu</h2><ProjectMenu projectId="standalone-menu" label="独立项目菜单"
      items={[{ type: 'action', id: 'edit', label: '编辑项目', icon: 'edit' }]} onAction={id => setLast(`project action=${id}`)} /></div>
      <div><h2>SessionMenu</h2><SessionMenu sessionId="standalone-session-menu" label="独立会话菜单"
        items={[{ type: 'action', id: 'custom', label: '调用方操作', icon: 'read' }]} onAction={id => setLast(`session action=${id}`)} /></div></section>
    <p role="status">{last}</p>
  </main></UIProvider>;
}

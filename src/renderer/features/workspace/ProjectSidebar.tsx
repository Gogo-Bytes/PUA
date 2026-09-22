import { Input } from '../../ui';
import { useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import type { ChatTreeNode } from '../../../shared/ipc/conversation';
import { Button, Icon, IconButton, InlineRename } from '../../ui';
import { groupProjects, projectName } from './selection';
import type { WorkspaceSessionInfo } from './useWorkspace';

interface ProjectSidebarProps {
  sessions: readonly WorkspaceSessionInfo[];
  recentProjects: readonly string[];
  activeId: string | null;
  activeProject?: string;
  creatingProject?: string;
  runtimeAvailable: boolean;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onNavigateBack?(): void;
  onNavigateForward?(): void;
  collapsedProjects?: readonly string[];
  onCollapsedProjectsChange?(projects: readonly string[]): void;
  onNewConversation(cwd?: string): void;
  onOpenTerminal?(cwd: string): void;
  onSelectSession(id: string): void;
  onTogglePinned?(id: string, pinned: boolean): void | Promise<void>;
  onCloseSession(id: string): void;
  onRenameSession(id: string, title: string): void | Promise<void>;
  onForkSession?(id: string, entryId: string): void | Promise<void>;
  onSearch(): void;
  onSettings(): void;
}

/** Production navigation: projects own nested task rows; existing sessions are never represented as tabs. */
export function ProjectSidebar({
  sessions, recentProjects, activeId, activeProject, creatingProject, runtimeAvailable, collapsedProjects: persistedCollapsed, onCollapsedProjectsChange,
  canNavigateBack = false, canNavigateForward = false, onNavigateBack, onNavigateForward, onNewConversation, onOpenTerminal, onSelectSession, onTogglePinned, onCloseSession, onRenameSession, onForkSession, onSearch, onSettings,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(new Set());
  const collapsed = new Set(persistedCollapsed ?? localCollapsed);
  const toggleProject = (cwd: string) => {
    const next = new Set(collapsed);
    next.has(cwd) ? next.delete(cwd) : next.add(cwd);
    if (onCollapsedProjectsChange) onCollapsedProjectsChange([...next]); else setLocalCollapsed(next);
  };
  const projects = groupProjects([...sessions], [...recentProjects]);
  const visible = projects.filter(project => `${project.name}\n${project.cwd}\n${project.sessions.map(session => session.title).join('\n')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <nav className="workspace-sidebar codex-sidebar" aria-label="项目">
    <div className="codex-sidebar-brand">
      <Button className="codex-brand-button" variant="ghost" aria-label="PUA 菜单" onClick={onSettings}><strong>PUA</strong><Icon name="down"/></Button>
      <span className="codex-sidebar-actions"><IconButton icon="search" label="搜索与命令" variant="ghost" onClick={onSearch}/><IconButton icon="settings" label="桌面设置" variant="ghost" onClick={onSettings}/></span>
    </div>
    <Button className="codex-sidebar-new" variant="ghost" aria-label="新建会话" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation(activeProject)}>
      <Icon name="edit"/><span>{creatingProject && creatingProject === activeProject ? '正在创建…' : '新对话'}</span><Icon name="plus"/>
    </Button>
    <label className="codex-sidebar-search">
      <span className="ui-visually-hidden">筛选项目和会话</span><Icon name="search"/>
      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="查找项目或会话…"/>
    </label>
    <div className="workspace-project-tree codex-project-tree">
      <div className="codex-section-heading"><span>项目</span><IconButton icon="plus" label="打开项目并新建对话" variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation()}/></div>
      {visible.length === 0 ? <p className="ui-meta">暂无匹配项目</p> : visible.map(project => <section className="workspace-project-group" key={project.cwd} aria-label={project.name}>
        <div className="workspace-project-line codex-project-line">
          {project.sessions.length > 0 && <Button variant="ghost" className="workspace-project-collapse codex-project-folder-toggle" aria-label={`${collapsed.has(project.cwd) ? '展开' : '折叠'} ${project.name}`} aria-expanded={!collapsed.has(project.cwd)} onClick={() => toggleProject(project.cwd)}><Icon name={collapsed.has(project.cwd) ? 'folder' : 'folderOpen'}/></Button>}
          <Button variant="ghost" className="workspace-project-button codex-project-button" title={project.cwd} aria-current={activeProject === project.cwd && !activeId ? 'page' : undefined} onClick={() => onNewConversation(project.cwd)}>
            {project.sessions.length === 0 && <Icon name="folder"/>}<span>{project.name}</span>{creatingProject === project.cwd && <span className="spinner" aria-label="正在创建对话"/>}
          </Button>
          <span className="codex-menu-tail"><span className="codex-menu-actions" aria-label={`${project.name} 操作`}>
            <IconButton className="codex-menu-action" icon="plus" label={`在 ${project.name} 中新建对话（${project.cwd}）`} variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation(project.cwd)}/>
            {onOpenTerminal && <IconButton className="codex-menu-action" icon="code" label={`在 ${project.name} 中打开兼容终端（${project.cwd}）`} variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onOpenTerminal(project.cwd)}/>}
          </span></span>
        </div>
        {project.sessions.length > 0 && !collapsed.has(project.cwd) && <ul className="workspace-session-list" aria-label={`${project.name} 的会话`}>
          {[...project.sessions].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.id.localeCompare(b.id)).map(session => <li key={session.id} className="workspace-session-item">
            <div className="workspace-session-row codex-session-row" data-active={session.id === activeId || undefined}>
            <InlineRename value={session.title} selected={session.id === activeId} selectionRole="button" current={session.id === activeId} labels={{ hint: `${sessionDescription(session)} · 双击或 F2 重命名`, input: name => `重命名 ${name}`, save: '保存', cancel: '取消', empty: '名称不能为空', failed: '重命名失败' }} onSelect={() => onSelectSession(session.id)} onRename={title => onRenameSession(session.id, title)}/>
            <span className="codex-menu-tail">
            {session.needsAttention && <i className="workspace-session-attention" aria-label="需要关注">!</i>}
            {session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="ui-session-activity" aria-label="处理中"/>}
            <span className="codex-menu-actions" aria-label={`${session.title} 操作`}>
              {onTogglePinned && <IconButton className="codex-menu-action" icon="pin" aria-pressed={!!session.pinned} label={session.pinned ? `取消置顶 ${session.title}` : `置顶 ${session.title}`} variant="ghost" onClick={() => void onTogglePinned(session.id, !session.pinned)}/>}
              <IconButton className="codex-menu-action" icon="close" label={`关闭 ${session.title}`} variant="ghost" onClick={() => onCloseSession(session.id)}/>
            </span>
            </span>
            </div>
            {session.sessionTree?.length && onForkSession ? <TreeBranch nodes={session.sessionTree} onFork={entryId => void onForkSession(session.id, entryId)}/> : null}
          </li>)}
        </ul>}
      </section>)}
    </div>
    <section className="workspace-recent codex-recent" aria-label="最近任务">
      <Button variant="ghost" className="workspace-recent-toggle" aria-expanded={recentOpen} onClick={() => setRecentOpen(open => !open)}><Icon name="clock"/><span>最近</span><span aria-hidden="true">{recentOpen ? '⌄' : '›'}</span></Button>
      {recentOpen && <ul className="workspace-recent-list" aria-label="最近任务列表">
        {sessions.filter(session => `${session.title}\n${session.cwd}`.toLowerCase().includes(query.trim().toLowerCase())).slice().sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || a.id.localeCompare(b.id)).slice(0, 8).map(session => <li key={session.id} data-active={session.id === activeId || undefined}>
          <Button variant="ghost" className="workspace-recent-item" aria-current={session.id === activeId ? 'page' : undefined} onClick={() => onSelectSession(session.id)}><Icon name={session.kind === 'terminal' ? 'code' : 'chat'}/><span><strong>{session.title}</strong><small>{projectName(session.cwd)}</small></span></Button>
        </li>)}
        {!sessions.length && <li className="ui-meta">暂无最近任务</li>}
      </ul>}
    </section>
    <div className="codex-sidebar-account"><span className="codex-account-avatar">PI</span><span><strong>本机 Pi</strong><small>{runtimeAvailable ? '已连接' : '尚未连接'}</small></span><IconButton icon="settings" label="账户设置" variant="ghost" onClick={onSettings}/></div>
  </nav>;
}

function TreeBranch({ nodes, onFork, depth = 0 }: { nodes: readonly ChatTreeNode[]; onFork(entryId: string): void; depth?: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return <ul className="workspace-session-branches" style={{ paddingLeft: `${12 + depth * 10}px` }}>{nodes.map(node => <li key={node.entryId}>
    <span className="workspace-branch-row">{node.children.length > 0 && <Button variant="ghost" className="workspace-branch-collapse" aria-label={`${collapsed.has(node.entryId) ? '展开' : '折叠'}分支`} aria-expanded={!collapsed.has(node.entryId)} onClick={() => setCollapsed(current => { const next = new Set(current); next.has(node.entryId) ? next.delete(node.entryId) : next.add(node.entryId); return next; })}>{collapsed.has(node.entryId) ? '▸' : '▾'}</Button>}{node.forkable === false ? <span aria-current={node.active ? 'true' : undefined} style={node.active ? { fontWeight: 600 } : undefined}>{node.label || node.entryId}{node.active ? ' · 当前' : ''}</span> : <Button variant="ghost" aria-current={node.active ? 'true' : undefined} onClick={() => onFork(node.entryId)} title={node.active ? '当前活动分支；从此历史节点创建分支' : '从此历史节点创建分支'}>↗ {node.label || node.entryId}{node.active ? ' · 当前' : ''}</Button>}</span>
    {node.children.length && !collapsed.has(node.entryId) ? <TreeBranch nodes={node.children} onFork={onFork} depth={depth + 1}/> : null}
  </li>)}</ul>;
}

function sessionDescription(session: SessionInfo): string {
  const kind = session.kind === 'terminal' ? '兼容终端' : '对话';
  const status = session.processStatus === 'starting' ? '连接中' : session.processStatus === 'exited' ? '已退出' : session.activity === 'idle' ? '就绪' : '处理中';
  return `${kind} · ${status}`;
}

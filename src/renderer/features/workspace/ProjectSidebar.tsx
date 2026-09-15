import { useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, Icon, IconButton, InlineRename, Tooltip } from '../../ui';
import { groupProjects } from './selection';

interface ProjectSidebarProps {
  sessions: readonly SessionInfo[];
  recentProjects: readonly string[];
  activeId: string | null;
  activeProject?: string;
  creatingProject?: string;
  runtimeAvailable: boolean;
  onNewConversation(cwd?: string): void;
  onSelectSession(id: string): void;
  onCloseSession(id: string): void;
  onRenameSession(id: string, title: string): void | Promise<void>;
  onSearch(): void;
  onSettings(): void;
}

/** Production navigation: projects own nested task rows; existing sessions are never represented as tabs. */
export function ProjectSidebar({
  sessions, recentProjects, activeId, activeProject, creatingProject, runtimeAvailable,
  onNewConversation, onSelectSession, onCloseSession, onRenameSession, onSearch, onSettings,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('');
  const projects = groupProjects([...sessions], [...recentProjects]);
  const visible = projects.filter(project => `${project.name}\n${project.cwd}\n${project.sessions.map(session => session.title).join('\n')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <nav className="workspace-sidebar" aria-label="项目">
    <div className="workspace-sidebar-brand">
      <strong>PUA</strong>
      <span className="workspace-sidebar-actions">
        <IconButton icon="search" label="搜索与命令" variant="ghost" onClick={onSearch}/>
        <IconButton icon="settings" label="桌面设置" variant="ghost" onClick={onSettings}/>
      </span>
    </div>
    <Button className="workspace-new-conversation" variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation(activeProject)}>
      <Icon name="edit"/><span>{creatingProject && creatingProject === activeProject ? '正在创建…' : '新对话'}</span><span aria-hidden="true">＋</span>
    </Button>
    <label className="workspace-project-filter">
      <span className="ui-visually-hidden">筛选项目和会话</span>
      <Icon name="search"/>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="查找项目或会话…"/>
    </label>
    <div className="workspace-project-tree">
      <div className="workspace-tree-heading"><span>项目</span><IconButton icon="plus" label="打开项目并新建对话" variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation()}/></div>
      {visible.length === 0 ? <p className="ui-meta">暂无匹配项目</p> : visible.map(project => <section className="workspace-project-group" key={project.cwd} aria-label={project.name}>
        <div className="workspace-project-line">
          <Tooltip content={project.cwd}><Button variant="ghost" className="workspace-project-button" title={project.cwd} aria-current={activeProject === project.cwd && !activeId ? 'page' : undefined} onClick={() => onNewConversation(project.cwd)}>
            <Icon name="folder"/><span>{project.name}</span>{creatingProject === project.cwd && <span className="spinner" aria-label="正在创建对话"/>}
          </Button></Tooltip>
          <IconButton icon="plus" label={`在 ${project.name} 中新建对话`} variant="ghost" disabled={!runtimeAvailable || !!creatingProject} onClick={() => onNewConversation(project.cwd)}/>
        </div>
        {project.sessions.length > 0 && <ul className="workspace-session-list" aria-label={`${project.name} 的会话`}>
          {project.sessions.map(session => <li key={session.id} className="workspace-session-row" data-active={session.id === activeId || undefined}>
            <Icon name={session.kind === 'terminal' ? 'code' : 'chat'}/>
            <InlineRename value={session.title} selected={session.id === activeId} selectionRole="button" current={session.id === activeId} labels={{ hint: `${sessionDescription(session)} · 双击或 F2 重命名`, input: name => `重命名 ${name}`, save: '保存', cancel: '取消', empty: '名称不能为空', failed: '重命名失败' }} onSelect={() => onSelectSession(session.id)} onRename={title => onRenameSession(session.id, title)}/>
            {session.activity !== 'idle' && session.processStatus !== 'exited' && <i className="ui-session-activity" aria-label="处理中"/>}
            <IconButton className="workspace-session-close" icon="close" label={`关闭 ${session.title}`} variant="ghost" onClick={() => onCloseSession(session.id)}/>
          </li>)}
        </ul>}
      </section>)}
    </div>
    <div className="sidebar-bottom"><span className="ui-meta">{runtimeAvailable ? '本机 Pi' : '尚未连接 Pi'}</span></div>
  </nav>;
}

function sessionDescription(session: SessionInfo): string {
  const kind = session.kind === 'terminal' ? '兼容终端' : '对话';
  const status = session.processStatus === 'starting' ? '连接中' : session.processStatus === 'exited' ? '已退出' : session.activity === 'idle' ? '就绪' : '处理中';
  return `${kind} · ${status}`;
}

import { Code2, Search, Settings2, SquarePen } from 'lucide-react';
import { useId } from 'react';
import { ActionScope, actionKey, useActions } from './actions';
import { ProjectRow } from './ProjectRow';
import { SessionRow } from './SessionRow';
import { Feedback } from './shared';
import { uniqueById } from './identity';
import type { SidebarLabels, SidebarProject, SidebarProps, SidebarSession } from './types';

const defaults: SidebarLabels = { navigation: '项目与会话', projects: '项目', recent: '最近', newSession: '新对话', search: '搜索', commands: '命令', settings: '设置', emptyProjects: '还没有项目', emptySessions: '暂无会话', loading: '正在加载…' };
const globalTarget = actionKey('global', 'sidebar');

/** Controlled navigation. No sorting, persistence, timestamp parsing, or host calls. */
export function Sidebar(props: SidebarProps) {
  const projects = uniqueById(props.projects), sessions = uniqueById(props.sessions);
  const targets = [globalTarget, ...projects.map(project => actionKey('project', project.id)), ...sessions.map(session => actionKey('session', session.id))];
  return <ActionScope targets={targets}><SidebarContent {...props} projects={projects} sessions={sessions} /></ActionScope>;
}
function SidebarContent(props: SidebarProps) {
  const { projects, sessions } = props;
  const actions = useActions();
  const labels = { ...defaults, ...props.labels };
  const byId = new Map(sessions.map(session => [session.id, session]));
  const currentProject = projects.find(project => project.id === props.selectedProjectId);
  const projectId = currentProject?.id ?? null;
  const newTarget = projectId === null ? globalTarget : actionKey('project', projectId);
  function renderSession(session: SidebarSession, nested = false) {
    return <li key={session.id}><SessionRow session={session} nested={nested} selected={props.selectedSessionId === session.id}
      disabled={props.disabled || props.loading} onSelect={props.onSelectSession ? () => props.onSelectSession!(session.id) : undefined}
      onPin={props.onPinSession ? next => props.onPinSession!(session.id, next) : undefined}
      onSnooze={props.onSnoozeSession ? () => props.onSnoozeSession!(session.id) : undefined}
      onMenuAction={props.onSessionMenuAction ? id => props.onSessionMenuAction!(session.id, id) : undefined}
      onPrimaryAction={props.onSessionPrimaryAction ? id => props.onSessionPrimaryAction!(session.id, id) : undefined} /></li>;
  }
  function projectSessions(project: SidebarProject) {
    return [...new Set(project.sessionIds)].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  }
  return <nav className={`pua-sidebar ${props.className ?? ''}`} aria-label={labels.navigation} aria-busy={props.loading || undefined}>
    <header className="pua-sidebar-header">
      {props.onNewSession && <button type="button" className="pua-nav-button" disabled={props.disabled || props.loading || currentProject?.disabled || !!currentProject?.disabledReason}
        aria-disabled={actions.pending(newTarget) || undefined} aria-busy={actions.pending(newTarget) || undefined}
        onClick={() => { const id = projectId, callback = props.onNewSession!; void actions.run(newTarget, labels.newSession, () => callback(id)); }}><SquarePen size={16} /><span>{labels.newSession}</span></button>}
      {props.onSearch && <button type="button" className="pua-nav-button" disabled={props.disabled} aria-busy={actions.pending(globalTarget, 'navigation') || undefined}
        onClick={() => { void actions.run(globalTarget, labels.search, props.onSearch!, 'navigation'); }}><Search size={16} /><span>{labels.search}</span></button>}
      {props.onCommands && <button type="button" className="pua-nav-button" disabled={props.disabled} aria-busy={actions.pending(globalTarget, 'navigation') || undefined}
        onClick={() => { void actions.run(globalTarget, labels.commands, props.onCommands!, 'navigation'); }}><Code2 size={16} /><span>{labels.commands}</span></button>}
    </header>
    <div className="pua-sidebar-scroll">
      {props.loading && <p className="pua-feedback" role="status">{labels.loading}</p>}
      {props.error && <p className="pua-error" role="alert">{props.error}</p>}
      <section aria-label={labels.projects}>
        <h2 className="pua-section-heading">{labels.projects}</h2>
        {!projects.length && !props.loading && <p className="pua-empty">{labels.emptyProjects}</p>}
        <ul className="pua-list pua-project-list">{projects.map(project => <ProjectGroup key={project.id} project={project} props={props} emptyLabel={labels.emptySessions}>
          {projectSessions(project).map(session => renderSession(session, true))}
        </ProjectGroup>)}</ul>
      </section>
      <section aria-label={labels.recent}>
        <h2 className="pua-section-heading">{labels.recent}</h2>
        <ul className="pua-list">{[...new Set(props.recentSessionIds)].flatMap(id => byId.has(id) ? [renderSession(byId.get(id)!)] : [])}</ul>
        {!props.recentSessionIds.some(id => byId.has(id)) && !props.loading && <p className="pua-empty">{labels.emptySessions}</p>}
      </section>
    </div>
    <footer className="pua-sidebar-footer">
      <Feedback target={globalTarget} />
      {props.onSettings && <button type="button" className="pua-nav-button" disabled={props.disabled} aria-busy={actions.pending(globalTarget, 'navigation') || undefined}
        onClick={() => { void actions.run(globalTarget, labels.settings, props.onSettings!, 'navigation'); }}><Settings2 size={16} /><span>{labels.settings}</span></button>}
    </footer>
  </nav>;
}
function ProjectGroup({ project, props, emptyLabel, children }: { project: SidebarProject; props: SidebarProps; emptyLabel: string; children: React.ReactNode[] }) {
  const regionId = useId();
  const expanded = props.expandedProjectIds.includes(project.id);
  return <li className="pua-project-group">
    <ProjectRow project={project} expanded={expanded} controls={regionId} disabled={props.disabled || props.loading}
      selected={props.selectedProjectId === project.id && !props.selectedSessionId}
      onExpandedChange={props.onProjectExpandedChange ? next => props.onProjectExpandedChange!(project.id, next) : undefined}
      onSelect={props.onSelectProject ? () => props.onSelectProject!(project.id) : undefined}
      onNewSession={props.onNewSession ? () => props.onNewSession!(project.id) : undefined}
      onAction={props.onProjectAction ? id => props.onProjectAction!(project.id, id) : undefined} />
    <ul id={regionId} className="pua-list pua-project-sessions" aria-label={`${project.title} 的会话`} hidden={!expanded}>
      {expanded && (children.length ? children : <li className="pua-empty is-nested">{emptyLabel}</li>)}
    </ul>
  </li>;
}

import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, Icon, IconButton, Tooltip } from '../../ui';
import { groupProjects } from './selection';

export type ProjectNavItem = { cwd: string; name: string; sessions: number };
export interface ProjectNavLabels {
  title: string;
  add: string;
  empty: string;
}

export interface ProjectNavProps {
  projects: readonly ProjectNavItem[];
  selectedCwd?: string;
  onSelect(cwd: string): void;
  onAdd?(): void;
  labels?: Partial<ProjectNavLabels>;
  pathVisibility?: 'always' | 'duplicates';
  showCount?: boolean;
  selectionMode?: 'current' | 'pressed';
}

export function ProjectNav({ projects, selectedCwd, onSelect, onAdd, labels, pathVisibility = 'duplicates', showCount = false, selectionMode = 'current' }: ProjectNavProps) {
  const text = { title: 'Projects', add: 'Add project', empty: 'No projects yet.', ...labels };
  return <nav className="ui-project-nav" aria-label={text.title}>
    <div className="ui-module-heading"><span>{text.title}</span>{showCount && <small>{projects.length}</small>}{onAdd && <IconButton icon="plus" label={text.add} variant="ghost" onClick={onAdd}/>}</div>
    <div className="ui-project-list">{projects.length ? projects.map(project => {
      const duplicate = projects.some(other => other.cwd !== project.cwd && other.name === project.name);
      const showPath = pathVisibility === 'always';
      const row = <Button variant="ghost" className="ui-project-row" aria-current={selectionMode === 'current' && selectedCwd === project.cwd ? 'page' : undefined} aria-pressed={selectionMode === 'pressed' ? selectedCwd === project.cwd : undefined} title={project.cwd} onClick={() => onSelect(project.cwd)}><Icon name="folder"/><span className="ui-project-copy"><span>{project.name}</span>{showPath && <small>{project.cwd}</small>}</span><span className="ui-project-count">{project.sessions}</span></Button>;
      return <div key={project.cwd}>{!showPath && duplicate ? <Tooltip content={project.cwd}>{row}</Tooltip> : row}</div>;
    }) : <p className="ui-meta">{text.empty}</p>}</div>
  </nav>;
}

export function ProjectNavigation({ sessions, recentProjects, project, onSelect, onAdd }: { sessions: SessionInfo[]; recentProjects: string[]; project?: string; onSelect(cwd: string): void; onAdd?(): void }) {
  const projects = groupProjects(sessions, recentProjects).map(item => ({ cwd: item.cwd, name: item.name, sessions: item.sessions.length }));
  return <ProjectNav projects={projects} selectedCwd={project} onSelect={onSelect} onAdd={onAdd} labels={{ title: '项目', add: '打开项目', empty: '暂无项目' }}/>;
}

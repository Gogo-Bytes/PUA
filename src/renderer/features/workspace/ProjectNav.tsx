import { useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, Icon, IconButton, Tooltip } from '../../ui';
import { groupProjects } from './selection';

export type ProjectNavItem = { cwd: string; name: string; sessions: number };
export interface ProjectNavLabels {
  title: string;
  add: string;
  empty: string;
  filter: string;
  filterPlaceholder: string;
}

export interface ProjectNavProps {
  projects: readonly ProjectNavItem[];
  selectedCwd?: string;
  onSelect(cwd: string): void;
  onAdd?(): void;
  labels?: Partial<ProjectNavLabels>;
  pathVisibility?: 'always' | 'duplicates';
  filterable?: boolean;
  showCount?: boolean;
  selectionMode?: 'current' | 'pressed';
}

export function ProjectNav({ projects, selectedCwd, onSelect, onAdd, labels, pathVisibility = 'duplicates', filterable = false, showCount = false, selectionMode = 'current' }: ProjectNavProps) {
  const text = { title: 'Projects', add: 'Add project', empty: 'No projects yet.', filter: 'Filter projects', filterPlaceholder: 'Find project…', ...labels };
  const [query, setQuery] = useState('');
  const visible = projects.filter(project => `${project.name}\n${project.cwd}`.toLowerCase().includes(query.toLowerCase()));
  return <nav className="ui-project-nav" aria-label={text.title}>
    <div className="ui-module-heading"><span>{text.title}</span>{showCount && <small>{projects.length}</small>}{onAdd && <IconButton icon="plus" label={text.add} variant="ghost" onClick={onAdd}/>}</div>
    {filterable && projects.length > 0 && <input className="ui-input ui-project-filter" aria-label={text.filter} placeholder={text.filterPlaceholder} value={query} onChange={event => setQuery(event.target.value)}/>}
    <div className="ui-project-list">{visible.length ? visible.map(project => {
      const duplicate = projects.some(other => other.cwd !== project.cwd && other.name === project.name);
      const showPath = pathVisibility === 'always';
      const row = <Button variant="ghost" className="ui-project-row" aria-current={selectionMode === 'current' && selectedCwd === project.cwd ? 'page' : undefined} aria-pressed={selectionMode === 'pressed' ? selectedCwd === project.cwd : undefined} title={showPath ? project.cwd : undefined} onClick={() => onSelect(project.cwd)}><Icon name="folder"/><span className="ui-project-copy"><span>{project.name}</span>{showPath && <small>{project.cwd}</small>}</span><span className="ui-project-count">{project.sessions}</span></Button>;
      return <div key={project.cwd}>{!showPath && duplicate ? <Tooltip content={project.cwd}>{row}</Tooltip> : row}</div>;
    }) : <p className="ui-meta">{text.empty}</p>}</div>
  </nav>;
}

export function ProjectNavigation({ sessions, recentProjects, project, onSelect }: { sessions: SessionInfo[]; recentProjects: string[]; project?: string; onSelect(cwd: string): void }) {
  const projects = groupProjects(sessions, recentProjects).map(item => ({ cwd: item.cwd, name: item.name, sessions: item.sessions.length }));
  return <ProjectNav projects={projects} selectedCwd={project} onSelect={onSelect} pathVisibility="always" filterable showCount selectionMode="pressed" labels={{ title: '项目', empty: '暂无项目', filter: '筛选项目', filterPlaceholder: '查找项目…' }}/>;
}

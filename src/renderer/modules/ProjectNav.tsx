import { Button, Icon, IconButton, Tooltip } from '../ui';
export type Project = { cwd: string; name: string; sessions: number };
export interface ProjectNavLabels { title: string; add: string; empty: string }
export function ProjectNav({ projects, selectedCwd, onSelect, onAdd, labels }: { projects: Project[]; selectedCwd: string; onSelect(cwd: string): void; onAdd(): void; labels?: Partial<ProjectNavLabels> }) {
  const text = { title: 'Projects', add: 'Add project', empty: 'No projects yet.', ...labels };
  return <nav className="ui-project-nav" aria-label={text.title}><div className="ui-module-heading"><span>{text.title}</span><IconButton icon="plus" label={text.add} variant="ghost" onClick={onAdd}/></div>{projects.length ? projects.map(project => {
    const row = <Button variant="ghost" className="ui-project-row" aria-current={selectedCwd === project.cwd ? 'page' : undefined} onClick={() => onSelect(project.cwd)}><Icon name="folder"/><span>{project.name}</span><small>{project.sessions}</small></Button>;
    return <div key={project.cwd}>{projects.filter(other => other.name === project.name).length > 1 ? <Tooltip content={project.cwd}>{row}</Tooltip> : row}</div>;
  }) : <p className="ui-meta">{text.empty}</p>}</nav>;
}

import type { ProjectNavItem, WorkspaceSessionTab } from '../../src/renderer/features/workspace';
// Preview-only fixtures. No Pi, Git, desktop bridge or disk integrations.
export const projects: ProjectNavItem[] = [
  { cwd: '/fixture/work/atlas', name: 'Atlas', sessions: 3 },
  { cwd: '/fixture/personal/atlas', name: 'Atlas', sessions: 1 },
  { cwd: '/fixture/work/orbit', name: 'Orbit design', sessions: 2 },
  { cwd: '/fixture/labs/notes', name: 'Field notes', sessions: 0 },
];
export const sessions: WorkspaceSessionTab[] = [{ id: 'plan', title: '规划下一次发布' }, { id: 'review', title: '审阅组件' }];

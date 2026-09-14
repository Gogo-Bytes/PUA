export type TaskStatus = 'idle' | 'running' | 'queued' | 'failed' | 'exited' | 'archived';
export interface TaskDraft { revision: number; text: string; attachmentIds: string[] }
export interface TaskView { scrollTop: number; inspectorOpen: boolean }
export interface TaskInfo { id: string; projectCwd: string; title: string; kind: 'chat' | 'terminal'; createdAt: string; updatedAt: string; status: TaskStatus; sessionId?: string; pinned: boolean; draft: TaskDraft; view: TaskView }
export interface TaskWorkspaceState { tasks: TaskInfo[]; activeTaskId: string | null; activeProjectCwd: string | null; recentTaskIds: string[]; archivedTaskIds: string[] }
export type TaskAction =
  | { type: 'task-added'; task: TaskInfo }
  | { type: 'task-selected'; id: string }
  | { type: 'task-updated'; id: string; patch: Partial<TaskInfo> }
  | { type: 'task-archived'; id: string }
  | { type: 'task-restored'; id: string }
  | { type: 'task-removed'; id: string };

export function reduceTaskWorkspace(state: TaskWorkspaceState, action: TaskAction): TaskWorkspaceState {
  if (action.type === 'task-added') return { ...state, tasks: [...state.tasks, action.task], activeTaskId: action.task.id, activeProjectCwd: action.task.projectCwd, recentTaskIds: [action.task.id, ...state.recentTaskIds.filter(id => id !== action.task.id)] };
  if (action.type === 'task-selected') { const task = state.tasks.find(item => item.id === action.id); return task ? { ...state, activeTaskId: task.id, activeProjectCwd: task.projectCwd, recentTaskIds: [task.id, ...state.recentTaskIds.filter(id => id !== task.id)] } : state; }
  if (action.type === 'task-updated') return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, ...action.patch, updatedAt: new Date().toISOString() } : task) };
  if (action.type === 'task-archived') return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, status: 'archived' } : task), archivedTaskIds: [...new Set([...state.archivedTaskIds, action.id])] };
  if (action.type === 'task-restored') return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, status: 'idle' } : task), archivedTaskIds: state.archivedTaskIds.filter(id => id !== action.id) };
  const tasks = state.tasks.filter(task => task.id !== action.id); return { ...state, tasks, activeTaskId: state.activeTaskId === action.id ? null : state.activeTaskId, recentTaskIds: state.recentTaskIds.filter(id => id !== action.id), archivedTaskIds: state.archivedTaskIds.filter(id => id !== action.id) };
}

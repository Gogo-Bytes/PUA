import { useState, type ReactNode } from 'react';
import type { RuntimeInfo, SessionInfo } from '../../shared/ipc/desktop-api';
import { IconButton, Tabs } from '../ui';
import { TaskDetailsPanel } from '../features/workspace';

export function InspectorShell({ task, runtime, changes, onClose, onOpenProject, onRename, onArchive, onTogglePinned, onClone }: { task: SessionInfo; runtime: RuntimeInfo | null; changes: ReactNode; onClose(): void; onOpenProject(): void; onRename(): void; onArchive(): void | Promise<void>; onTogglePinned?(): void | Promise<void>; onClone?(): void | Promise<void> }) {
  // Preserve the existing inspector default; task details are now one keyboard-accessible tab away.
  const [view, setView] = useState<'task' | 'git'>('git');
  return <aside className="inspector-shell" aria-label="任务检查器">
    <div className="inspector-shell-header"><strong>{view === 'task' ? '任务详情' : 'Git / 环境'}</strong><IconButton icon="close" label="关闭右侧面板" variant="ghost" onClick={onClose}/></div>
    <Tabs label="检查器视图" value={view} onChange={value => setView(value as 'task' | 'git')} items={[{ value: 'task', label: '任务详情' }, { value: 'git', label: 'Git / 环境' }]}/>
    <div className="inspector-shell-body">
      <div hidden={view !== 'task'}><TaskDetailsPanel task={task} runtime={runtime} onOpenProject={onOpenProject} onRename={onRename} onArchive={onArchive} onTogglePinned={onTogglePinned} onClone={onClone}/></div>
      <div hidden={view !== 'git'} className="inspector-shell-git">{changes}</div>
    </div>
  </aside>;
}

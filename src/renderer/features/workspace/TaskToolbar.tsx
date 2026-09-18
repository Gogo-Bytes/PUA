import type { ReactNode, Ref } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { Breadcrumbs, Button, DropdownMenu, Icon, StatusBadge, Tag } from '../../ui';
import { projectName } from './selection';

export interface TaskToolbarProps {
  task: SessionInfo;
  inspectorToggleRef?: Ref<HTMLButtonElement>;
  inspectorOpen: boolean;
  onToggleInspector(): void;
  onSelectProject?(): void;
  onOpenProject(): void;
  onRename(): void;
  onArchive(): void | Promise<void>;
  onTogglePinned?(): void | Promise<void>;
  children?: ReactNode;
}

/** Task-scoped actions. Pi-native message Fork stays in the conversation actions. */
export function TaskToolbar({ task, inspectorToggleRef, inspectorOpen, onToggleInspector, onSelectProject, onOpenProject, onRename, onArchive, onTogglePinned, children }: TaskToolbarProps) {
  const status = taskStatus(task);
  const menuItems = [
    { value: 'rename', label: '重命名任务' },
    ...(onTogglePinned ? [{ value: 'pin', label: task.pinned ? '取消置顶' : '置顶任务' }] : []),
    { value: 'archive', label: '归档并关闭任务' },
  ];
  return <header className="session-toolbar task-toolbar" aria-label="当前任务操作栏">
    <div className="task-toolbar-location">
      <Breadcrumbs label="当前任务位置" items={[{ id: task.cwd, label: projectName(task.cwd), ...(onSelectProject ? { onSelect: onSelectProject } : {}) }, { id: task.id, label: task.title }]}/>
      <Tag><Icon name={task.kind === 'terminal' ? 'terminal' : 'chat'}/>{task.kind === 'terminal' ? '兼容终端' : 'Pi 对话'}</Tag>
      <StatusBadge status={status.badge} label={status.label}/>
    </div>
    <div className="task-toolbar-actions">
      <Button variant="ghost" onClick={onOpenProject}>打开目录</Button>
      {children}
      <Button ref={inspectorToggleRef} variant="ghost" aria-expanded={inspectorOpen} onClick={onToggleInspector}>{inspectorOpen ? '收起' : '显示'} 检查器</Button>
      <DropdownMenu label="更多任务操作" items={menuItems} onAction={value => {
        if (value === 'rename') onRename();
        else if (value === 'pin') void onTogglePinned?.();
        else if (value === 'archive') void onArchive();
      }}/>
    </div>
  </header>;
}

function taskStatus(task: SessionInfo): { label: string; badge: 'idle' | 'running' | 'error' | 'paused' } {
  if (task.archived) return { label: '已归档', badge: 'paused' };
  if (task.processStatus === 'starting') return { label: '连接中', badge: 'paused' };
  if (task.processStatus === 'exited') return { label: '已退出', badge: 'error' };
  if (task.activity === 'compacting') return { label: '压缩上下文', badge: 'running' };
  if (task.activity === 'retrying') return { label: '重试中', badge: 'running' };
  if (task.activity === 'waiting-input') return { label: '等待输入', badge: 'paused' };
  if (task.activity === 'responding') return { label: '处理中', badge: 'running' };
  return { label: '就绪', badge: 'idle' };
}

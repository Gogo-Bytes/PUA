import type { ReactNode, Ref } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { DropdownMenu, Icon, IconButton } from '../../ui';
import { projectName } from './selection';

export interface WorkspaceChromeProps {
  active?: SessionInfo;
  project?: string;
  leftOpen: boolean;
  rightOpen: boolean;
  leftToggleRef?: Ref<HTMLButtonElement>;
  rightToggleRef?: Ref<HTMLButtonElement>;
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  onToggleLeft(): void;
  onToggleRight(): void;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onOpenProject?(): void;
  onOpenTerminal?(): void;
  onSearchTerminal?(): void;
  onChooseReferences?(): void;
  onRename?(): void;
  onArchive?(): void | Promise<void>;
  onTogglePinned?(): void | Promise<void>;
  environment?: ReactNode;
}

/** Application-owned titlebar surface. Native traffic lights sit above it on macOS. */
export function WorkspaceChrome({ active, project, leftOpen, rightOpen, leftToggleRef, rightToggleRef, canNavigateBack, canNavigateForward, onToggleLeft, onToggleRight, onNavigateBack, onNavigateForward, onOpenProject, onOpenTerminal, onSearchTerminal, onChooseReferences, onRename, onArchive, onTogglePinned, environment }: WorkspaceChromeProps) {
  const menuItems = active ? [
    { value: 'rename', label: '重命名任务' },
    ...(onTogglePinned ? [{ value: 'pin', label: active.pinned ? '取消置顶' : '置顶任务' }] : []),
    { value: 'archive', label: '归档并关闭任务' },
  ] : [];
  return <header className="workspace-chrome" aria-label="窗口操作栏" onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || !rightOpen || event.target !== (rightToggleRef && 'current' in rightToggleRef ? rightToggleRef.current : null)) return;
    event.preventDefault();
    onToggleRight();
    (rightToggleRef && 'current' in rightToggleRef ? rightToggleRef.current : null)?.focus();
  }}>
    <div className="workspace-chrome-leading">
      <IconButton ref={leftToggleRef} icon="panel" label={leftOpen ? '收起项目栏' : '显示项目栏'} variant="ghost" aria-expanded={leftOpen} onClick={onToggleLeft}/>
      <span className="workspace-chrome-history" aria-label="工作区导航">
        <IconButton icon="back" label="后退" variant="ghost" disabled={!canNavigateBack} onClick={onNavigateBack}/>
        <IconButton icon="forward" label="前进" variant="ghost" disabled={!canNavigateForward} onClick={onNavigateForward}/>
      </span>
    </div>
    <div className="workspace-chrome-title" aria-live="polite">
      {(active || project) && <><Icon name={active?.kind === 'terminal' ? 'terminal' : 'folder'}/><strong>{active?.title ?? projectName(project!)}</strong><span className="ui-meta">{active ? active.kind === 'terminal' ? '兼容终端' : 'Pi 对话' : '新对话草稿'}</span></>}
    </div>
    <div className="workspace-chrome-actions">
      {active && onOpenProject && <IconButton icon="folder" label="打开项目目录" variant="ghost" onClick={onOpenProject}/>} 
      {active && onOpenTerminal && <IconButton icon="terminal" label="打开兼容终端" variant="ghost" onClick={onOpenTerminal}/>} 
      {active?.kind === 'terminal' && onSearchTerminal && <IconButton icon="search" label="搜索终端历史" variant="ghost" onClick={onSearchTerminal}/>} 
      {active?.kind === 'terminal' && onChooseReferences && <IconButton icon="file" label="添加文件引用" variant="ghost" onClick={onChooseReferences}/>} 
      {active && menuItems.length > 0 && <DropdownMenu
        label="更多任务操作"
        icon="more"
        iconOnly
        items={menuItems}
        onAction={value => { if (value === 'rename') onRename?.(); else if (value === 'pin') void onTogglePinned?.(); else if (value === 'archive') void onArchive?.(); }}
      />}
      {environment}
      <IconButton ref={rightToggleRef} icon="panelRight" label={rightOpen ? '收起右侧面板' : '显示右侧面板'} variant="ghost" aria-expanded={rightOpen} onClick={onToggleRight}/>
    </div>
  </header>;
}

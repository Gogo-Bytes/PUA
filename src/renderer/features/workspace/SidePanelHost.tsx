import { useId, useRef, type ReactNode, type RefObject } from 'react';
import type { RuntimeInfo, SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, DropdownMenu, Icon, IconButton, PanelTabs } from '../../ui';
import { TaskDetailsPanel } from './TaskDetailsPanel';
import type { SidePanelKind, useSidePanelTabs } from './useSidePanelTabs';
import { FilesPanel } from './FilesPanel';
import { BrowserPanel } from './BrowserPanel';
import { SideChatPanel } from './SideChatPanel';

const entries = [
  { id: 'review', label: 'Review', icon: 'review' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'browser', label: 'Browser', icon: 'browser' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'side-chat', label: 'Side chat', icon: 'chat' },
  { id: 'task', label: '任务详情', icon: 'info' },
] as const;
const unavailable: Partial<Record<SidePanelKind, string>> = {
  terminal: '侧栏终端尚未接入。兼容终端仍可通过项目更多菜单打开；它遵守现有会话互斥规则。',
};

/** Right-side tab host, separate from the titlebar Environment popover. */
export function SidePanelHost({ task, cwd, runtime, panels, changes, terminalDockRef, onClose, onOpenProject, onRename, onArchive, onTogglePinned, onClone, onError }: {
  task?: SessionInfo; cwd?: string; runtime: RuntimeInfo | null; panels: ReturnType<typeof useSidePanelTabs>;
  changes: ReactNode; terminalDockRef?: RefObject<HTMLDivElement | null>; onClose(): void; onOpenProject(): void; onRename(): void;
  onArchive(): void | Promise<void>; onTogglePinned?(): void | Promise<void>; onClone?(): void | Promise<void>; onError?(message: string): void;
}) {
  const add = useRef<HTMLButtonElement>(null);
  const idPrefix = useId();
  const reportError = onError ?? (() => {});
  const tabs = panels.tabs.map(id => entries.find(entry => entry.id === id)!);
  const canOpen = (id: SidePanelKind) => id === 'side-chat' ? !!cwd && !!runtime : !!task || !['review', 'task'].includes(id);
  return <aside className="workspace-side-panel" aria-label="右侧面板">
    <div className="workspace-panel-header">
      <PanelTabs idPrefix={idPrefix} items={tabs} value={panels.active} onChange={id => panels.select(id as SidePanelKind)} onClose={id => panels.close(id as SidePanelKind)} emptyFocusRef={add}/>
      <DropdownMenu triggerRef={add} label="打开右侧标签页" icon="plus" iconOnly
        items={entries.map(entry => ({ value: entry.id, label: entry.label, disabled: !canOpen(entry.id) }))}
        onAction={id => panels.open(id as SidePanelKind)}/>
      <IconButton icon="panelRight" label="收起右侧面板" variant="ghost" onClick={onClose}/>
    </div>
    {!tabs.length ? <div className="workspace-panel-empty" aria-label="可打开的标签页">
      {entries.slice(0, 5).map(entry => <Button key={entry.id} variant="ghost" disabled={!canOpen(entry.id)} onClick={() => panels.open(entry.id)}>
        <Icon name={entry.icon}/><span>{entry.label}</span>{unavailable[entry.id] && <small>未接入</small>}
      </Button>)}
    </div> : <div className="workspace-panel-content">
      {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`${idPrefix}-panel-${tab.id}`} aria-labelledby={`${idPrefix}-tab-${tab.id}`} tabIndex={0} hidden={panels.active !== tab.id}>
        {tab.id === 'review' ? changes : tab.id === 'terminal' ? task?.kind === 'terminal' ? <div className="workspace-terminal-dock" ref={terminalDockRef} aria-label="兼容终端"/> : <div className="workspace-panel-unavailable"><Icon name="terminal"/><h2>Terminal</h2><p>终端面板复用当前兼容终端的唯一 PTY。请先切换到兼容终端会话。</p></div> : tab.id === 'files' ? <FilesPanel task={task}/> : tab.id === 'browser' ? <BrowserPanel/> : tab.id === 'side-chat' ? <SideChatPanel cwd={cwd} runtime={runtime} active={panels.active === 'side-chat'} onError={reportError}/> : tab.id === 'task' && task
          ? <TaskDetailsPanel task={task} runtime={runtime} onOpenProject={onOpenProject} onRename={onRename} onArchive={onArchive} onTogglePinned={onTogglePinned} onClone={onClone}/>
          : <div className="workspace-panel-unavailable"><Icon name={tab.icon}/><h2>{tab.label}</h2><span>尚未接入</span><p>{unavailable[tab.id]}</p></div>}
      </div>)}
    </div>}
  </aside>;
}

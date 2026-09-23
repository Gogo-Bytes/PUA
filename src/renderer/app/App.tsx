import { useWorkspaceComposition } from './useWorkspaceComposition';
import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from '../features/terminal';
import { ChatPane, PendingChatPane } from '../features/conversation';
import { desktopClient } from './desktop-client';
import { GitPanel } from '../features/change-review';
import { SidePanelHost, EnvironmentPopover, HistorySearchDialog, ProjectSidebar, WorkspaceChrome, readWorkspaceView, useSidePanelTabs, writeWorkspaceView } from '../features/workspace';
import { NewSessionDialog, RenameDialog } from '../features/sessions';
import { SettingsDialog } from '../features/preferences';
import { CommandPalette } from '../features/command-palette';
import { Button, Input, Icon, ResizableWorkspace, ToastHost, UIProvider } from '../ui';

export function App() {
  const panelToggle = useRef<HTMLButtonElement>(null);
  const leftPanelToggle = useRef<HTMLButtonElement>(null);
  const closeReview = () => { setReviewOpen(false); setTimeout(() => panelToggle.current?.focus(), 0); };
  const [reviewOpen, setReviewOpen] = useState(true);
  const [projectPanelOpen, setProjectPanelOpen] = useState(true);
  const { desktopPresentation, workspace, palette, input, launch, sessionActions, navigation } = useWorkspaceComposition(() => {});
  const { boot, theme, error } = desktopPresentation;
  const { sessions, activeId, active, project } = workspace;
  const panels = useSidePanelTabs(activeId ?? `draft:${project ?? ''}`);
  const [workspaceView, setWorkspaceView] = useState(() => readWorkspaceView());
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const attentionToasts = workspace.attentionEvents.map(event => ({
    id: event.id,
    tone: event.tone,
    announcement: event.tone === 'error' ? 'assertive' as const : 'polite' as const,
    children: <span><strong>{event.title}</strong>：{event.message}</span>,
    duration: event.kind === 'waiting-input' || event.tone === 'error' ? 0 : 7000,
    action: { label: '查看任务', onClick: () => navigation.selectSession(event.sessionId) },
  }));
  useEffect(() => {
    if (!boot) return;
    const preferred = workspaceView.activeProject && boot.preferences.recentProjects.includes(workspaceView.activeProject) ? workspaceView.activeProject : undefined;
    workspace.hydrateSessions(boot.restoredSessions ?? [], preferred);
  }, [boot]);
  useEffect(() => { writeWorkspaceView({ activeProject: project || workspaceView.activeProject, collapsedProjects: workspaceView.collapsedProjects }); }, [project, workspaceView]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey; if (event.isComposing || event.keyCode === 229) return; if (modifier && !event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); void launch.newConversation(active?.cwd || project); return; } if (modifier && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); palette.toggle(); } if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active?.kind === 'terminal') { event.preventDefault(); input.toggleSearch(); } };
    window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true);
  }, [boot?.platform, active?.kind, active?.cwd, project]);
  return <UIProvider theme={theme}><div className={`workspace ${boot?.platform === 'darwin' ? 'workspace-darwin' : ''}`}>
    <WorkspaceChrome active={active} project={project} leftOpen={projectPanelOpen} rightOpen={reviewOpen} leftToggleRef={leftPanelToggle} rightToggleRef={panelToggle}
      environment={<EnvironmentPopover session={active} onOpenPanel={kind => { panels.open(kind); setReviewOpen(true); }}/>}
      canNavigateBack={workspace.canNavigateBack} canNavigateForward={workspace.canNavigateForward}
      onToggleLeft={() => setProjectPanelOpen(open => !open)} onToggleRight={() => setReviewOpen(open => !open)}
      onNavigateBack={workspace.navigateBack} onNavigateForward={workspace.navigateForward}
      onOpenProject={active ? () => sessionActions.openProject(active.id) : undefined}
      onOpenTerminal={active ? () => launch.open({ cwd: active.cwd, kind: 'terminal', mode: 'new' }) : undefined}
      onSearchTerminal={active?.kind === 'terminal' ? () => input.toggleSearch() : undefined}
      onChooseReferences={active?.kind === 'terminal' ? () => void input.chooseTerminalReferences() : undefined}
      onRename={active ? sessionActions.beginRename : undefined} onArchive={active ? () => workspace.closeSession(active.id) : undefined}
      onTogglePinned={active ? () => workspace.setSessionPinned(active.id, !active.pinned) : undefined}/>
    <ResizableWorkspace rightSize={{ initial: 560, min: 280, max: 1000 }} leftToggleRef={leftPanelToggle} leftOpen={projectPanelOpen} onLeftOpenChange={setProjectPanelOpen} rightToggleRef={panelToggle} rightOpen={reviewOpen} onRightOpenChange={setReviewOpen} hideToolbar
      labels={{ left: '项目', right: '右侧面板', show: '显示', hide: '收起', resize: side => side === 'left' ? '调整项目栏宽度' : '调整右侧面板宽度', compact: '空间足够时自动恢复面板', hint: '拖动边缘或使用方向键调整宽度' }}
      left={<ProjectSidebar sessions={sessions} recentProjects={boot?.preferences.recentProjects ?? []} activeId={activeId} activeProject={project} collapsedProjects={workspaceView.collapsedProjects} onCollapsedProjectsChange={collapsed => setWorkspaceView(current => ({ ...current, collapsedProjects: [...collapsed] }))} creatingProject={launch.creatingProject} runtimeAvailable={!!boot?.runtime} canNavigateBack={workspace.canNavigateBack} canNavigateForward={workspace.canNavigateForward} onNavigateBack={workspace.navigateBack} onNavigateForward={workspace.navigateForward} onNewConversation={cwd => void launch.newConversation(cwd)} onOpenTerminal={cwd => launch.open({ cwd, kind: 'terminal', mode: 'new' })} onOpenProject={sessionActions.openProject} onCopyProjectPath={cwd => { void desktopClient.writeClipboard(cwd).catch(error => desktopPresentation.reportError(String(error))); }} onSelectSession={navigation.selectSession} onTogglePinned={(id, pinned) => void workspace.setSessionPinned(id, pinned)} onCloseSession={id => void workspace.closeSession(id)} onRenameSession={navigation.renameSession} onSearch={palette.openFromSidebar} onSettings={desktopPresentation.showSettings}/>}
      right={<SidePanelHost key={activeId ?? project} panels={panels} task={active} runtime={boot?.runtime ?? null} onClose={closeReview} onOpenProject={() => { if (active) sessionActions.openProject(active.id); }} onRename={sessionActions.beginRename} onArchive={() => { if (active) return workspace.closeSession(active.id); }} onTogglePinned={() => { if (active) return workspace.setSessionPinned(active.id, !active.pinned); }} onClone={() => { if (active) return sessionActions.cloneTask(active.id); }} changes={active && <GitPanel key={active.id} theme={theme} sessionId={active.id} onClose={() => panels.close('review')} onReference={input.reference}/>} />}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button aria-label="关闭错误提示" onClick={desktopPresentation.dismissError}>×</Button></div>}
      {!active && project ? <PendingChatPane cwd={project} runtimeAvailable={!!boot?.runtime} value={input.readProjectDraft(project)} onValueChange={text => input.replaceProjectDraft(project, text)} stagedAttachmentPaths={input.readProjectAttachmentPaths(project)} onStagedAttachmentPathsChange={paths => input.replaceProjectAttachmentPaths(project, paths)} onStart={(text, trust, attachmentPaths, initial) => navigation.startProjectConversation(project, text, trust, attachmentPaths, initial)} onSettings={desktopPresentation.showSettings}/> : !active && <section className="workspace-blank"><Icon name="chat"/><h1>{launch.creatingProject ? '正在创建对话…' : '开始一个新对话'}</h1><p>{boot?.runtimeError || '从左侧选择项目进入新的对话草稿；发送第一条消息后才会创建历史。'}</p></section>}
      {active?.kind === 'terminal' && input.searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); input.find(); }}><Input autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={input.searchText} onChange={event => { input.editSearch(event.target.value); }} /><span>{!input.found && '未找到'}</span><Button type="button" onClick={() => input.find(true)}>↑</Button><Button type="submit">↓</Button><Button type="button" onClick={() => { input.closeSearch(); }}>×</Button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}><div className="interaction-column"><div className="session-stage">{sessions.map(session => session.kind === 'terminal' ? <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} theme={theme} platform={boot?.platform ?? ''} onReady={input.onTerminalReady} onExit={workspace.markSessionExited} onError={desktopPresentation.reportError} /> : <ChatPane key={session.id} session={session} active={session.id === activeId} draft={input.readDraft(session.id)} initialMessage={input.readInitialSend(session.id)} initialAttachments={input.readInitialAttachments(session.id)} onInitialMessageSent={() => input.clearInitialSend(session.id)} onDraftChange={text => input.replaceDraft(session.id, text)} onError={desktopPresentation.reportError} onTerminalRecovery={() => { launch.open({ cwd: session.cwd, kind: 'terminal', mode: 'new' }); }} onCommands={commands => palette.onCommands(session.id, commands)} historyTarget={workspace.historyTarget?.sessionId === session.id ? workspace.historyTarget : undefined} />)}</div></div></div>
      {active?.kind === 'terminal' && <footer className="terminal-footer">兼容终端 · TUI 快捷键以 /hotkeys 为准 · {active.processStatus === 'exited' ? '进程已退出' : '独占会话'}</footer>}
    </ResizableWorkspace>
    {launch.isOpen && boot && <NewSessionDialog initialPath={launch.initialPath} initialKind={launch.initialKind} fixedKind={launch.fixedKind} initialMode={launch.initialMode} hasRuntime={!!boot.runtime} onClose={launch.close} onCreate={launch.create} onSettings={launch.showSettings} />}
    {sessionActions.renaming && active && <RenameDialog title={active.title} persistent={active.kind === 'chat'} onClose={sessionActions.closeRename} onSave={sessionActions.saveRename} />}
    {desktopPresentation.settingsOpen && boot && <SettingsDialog boot={boot} onClose={desktopPresentation.closeSettings} onSave={desktopPresentation.publish} />}
    <CommandPalette palette={palette} onInsert={input.insertCommand} onOpenHistorySearch={() => { palette.close(); setHistorySearchOpen(true); }} />
    <HistorySearchDialog open={historySearchOpen} onClose={() => setHistorySearchOpen(false)} onSearch={desktopClient.searchHistory} onSelect={workspace.openHistoryResult} onError={desktopPresentation.reportError} />
    <ToastHost items={attentionToasts} onDismiss={workspace.dismissAttention} label="后台任务提醒" />
  </div></UIProvider>;
}

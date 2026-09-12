import { useWorkspaceComposition } from './useWorkspaceComposition';
import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from '../features/terminal';
import { ChatPane } from '../features/conversation';
import { GitPanel } from '../features/change-review';
import { ProjectNavigation, projectName, RenameDialog, SessionTabs } from '../features/workspace';
import { NewSessionDialog } from '../features/session-launch';
import { SettingsDialog } from '../features/preferences';
import { CommandPalette } from '../features/command-palette';
import { Icon } from '../Icon';

export function App() {
  const [reviewOpen, setReviewOpen] = useState(() => window.innerWidth > 1100);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const closeReview = () => { setReviewOpen(false); panelToggle.current?.focus(); };
  const { desktopPresentation, workspace, palette, input, launch, sessionActions, navigation } = useWorkspaceComposition(() => { if (window.innerWidth <= 1100) setReviewOpen(false); });
  const { boot, theme, error } = desktopPresentation;
  const { sessions, activeId, active, project, projectSessions } = workspace;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey; if (event.isComposing || event.keyCode === 229) return; if (modifier && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); palette.toggle(); } if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active?.kind === 'terminal') { event.preventDefault(); input.toggleSearch(); } };
    window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true);
  }, [boot?.platform, active?.kind]);
  useEffect(() => {
    if (!reviewOpen || !active) return;
    // Bubble after local handlers; editable controls and terminal input own Escape.
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229 || window.innerWidth > 1100) return;
      if (document.querySelector('dialog[open], [role="menu"], .chat-pane.active .slash-menu')) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm')) return;
      event.preventDefault(); closeReview();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [reviewOpen, active?.id]);

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1100px)');
    const change = (event: MediaQueryListEvent) => { if (event.matches) setReviewOpen(false); };
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);

  return <div className="workspace">
    <aside className="sidebar" aria-label="项目导航"><div className="brand"><span className="brand-icon"><Icon name="pi" /></span><strong>PUA</strong><small>工作台</small></div>
      <button className="search-launch" onClick={palette.openFromSidebar} disabled={!active}><Icon name="search" />搜索与命令<kbd>⌘ K</kbd></button>
      <button className="new-button" onClick={() => launch.open()} disabled={!boot}><Icon name="plus" />打开项目</button>
      <ProjectNavigation sessions={sessions} recentProjects={boot?.preferences.recentProjects ?? []} project={project} onSelect={navigation.selectProject} />
      <div className="sidebar-bottom"><div className="connection"><span className={`status-dot ${boot?.runtime ? 'running' : 'exited'}`} /><span>{boot?.runtime ? '本机 Pi' : '尚未连接 Pi'}</span></div><button className="settings-button" onClick={desktopPresentation.showSettings} disabled={!boot}><Icon name="settings" />桌面设置</button></div>
    </aside>
    <main><header className="topbar"><SessionTabs sessions={projectSessions} activeId={activeId} onSelect={navigation.selectSession} onClose={id => void workspace.closeSession(id)} /><div className="topbar-actions"><button className="icon-button" aria-label="新建会话" title="新建会话" onClick={launch.openInProject} disabled={!boot}><Icon name="plus" /></button><button ref={panelToggle} className="icon-button" aria-label="显示或收起检查区" title="文件与 Git 检查区" aria-expanded={reviewOpen && !!active} disabled={!active} onClick={() => setReviewOpen(value => !value)}><Icon name="panel" /></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={desktopPresentation.dismissError}>×</button></div>}
      {!active && <section className="workspace-empty"><Icon name="chat" /><h1>{project ? projectName(project) : '打开项目，开始工作'}</h1>{project && <code>{project}</code>}<p>{project ? '此项目还没有打开的会话。新建对话或继续 Pi 保存的最近会话。' : '选择本机项目，与 Pi 对话。模型和工具仍由你的 Pi 管理。'}</p><div><button className="primary" onClick={() => launch.open()} disabled={!boot}>{project ? '创建会话' : '打开项目'}</button>{project && <button onClick={() => { launch.open({ cwd: project, kind: 'chat', mode: 'continue' }); }}>继续最近会话</button>}<button onClick={desktopPresentation.showSettings} disabled={!boot}>桌面设置</button></div>{boot?.runtimeError && <p className="form-error" role="alert">{boot.runtimeError}</p>}</section>}
      {active && <div className="session-toolbar"><div title={active.cwd} className="project-path"><Icon name="folder" /> {active.cwd}</div><div><button onClick={sessionActions.beginRename}>重命名</button>{active.kind === 'chat' && <button onClick={() => { launch.open({ cwd: active.cwd, kind: 'terminal', mode: 'new' }); }}>兼容终端</button>}<button onClick={() => sessionActions.openProject(active.id)}>打开目录</button>{active.kind === 'terminal' && <><button onClick={() => input.toggleSearch()}>搜索</button><button onClick={() => void input.chooseTerminalReferences()}>＋ 文件引用</button></>}</div></div>}
      {active?.kind === 'terminal' && input.searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); input.find(); }}><input autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={input.searchText} onChange={event => { input.editSearch(event.target.value); }} /><span>{!input.found && '未找到'}</span><button type="button" onClick={() => input.find(true)}>↑</button><button type="submit">↓</button><button type="button" onClick={() => { input.closeSearch(); }}>×</button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}><div className="interaction-column"><div className="session-stage">{sessions.map(session => session.kind === 'terminal' ? <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} theme={theme} platform={boot?.platform ?? ''} onReady={input.onTerminalReady} onExit={workspace.markSessionExited} onError={desktopPresentation.reportError} /> : <ChatPane key={session.id} session={session} active={session.id === activeId} draft={input.readDraft(session.id)} onDraftChange={text => input.replaceDraft(session.id, text)} onError={desktopPresentation.reportError} onTerminalRecovery={() => { launch.open({ cwd: session.cwd, kind: 'terminal', mode: 'new' }); }} onCommands={commands => palette.onCommands(session.id, commands)} />)}</div></div>{active && reviewOpen && <GitPanel key={active.id} sessionId={active.id} onClose={closeReview} onReference={input.reference} />}</div>
      {active?.kind === 'terminal' && <footer>兼容终端 · TUI 快捷键以 /hotkeys 为准 · {active.processStatus === 'exited' ? '进程已退出' : '独占会话'}</footer>}
    </main>
    {launch.isOpen && boot && <NewSessionDialog initialPath={launch.initialPath} initialKind={launch.initialKind} initialMode={launch.initialMode} hasRuntime={!!boot.runtime} onClose={launch.close} onCreate={launch.create} onSettings={launch.showSettings} />}
    {sessionActions.renaming && active && <RenameDialog title={active.title} persistent={active.kind === 'chat'} onClose={sessionActions.closeRename} onSave={sessionActions.saveRename} />}
    {desktopPresentation.settingsOpen && boot && <SettingsDialog boot={boot} onClose={desktopPresentation.closeSettings} onSave={desktopPresentation.publish} />}
    <CommandPalette palette={palette} onInsert={input.insertCommand} />
  </div>;
}

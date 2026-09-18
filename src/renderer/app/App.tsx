import { useWorkspaceComposition } from './useWorkspaceComposition';
import { useEffect, useRef, useState } from 'react';
import { TerminalPane } from '../features/terminal';
import { ChatPane, PendingChatPane } from '../features/conversation';
import { desktopClient } from './desktop-client';
import { GitPanel } from '../features/change-review';
import { ProjectSidebar, projectName } from '../features/workspace';
import { NewSessionDialog } from '../features/sessions';
import { SettingsDialog } from '../features/preferences';
import { CommandPalette } from '../features/command-palette';
import { Breadcrumbs, Button, Icon, ResizableWorkspace, UIProvider } from '../ui';

export function App() {
  const panelToggle = useRef<HTMLButtonElement>(null);
  const closeReview = () => { setReviewOpen(false); setTimeout(() => panelToggle.current?.focus(), 0); };
  const [reviewOpen, setReviewOpen] = useState(true);
  const { desktopPresentation, workspace, palette, input, launch, sessionActions, navigation } = useWorkspaceComposition(() => {});
  const { boot, theme, error } = desktopPresentation;
  const { sessions, activeId, active, project } = workspace;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey; if (event.isComposing || event.keyCode === 229) return; if (modifier && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); palette.toggle(); } if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active?.kind === 'terminal') { event.preventDefault(); input.toggleSearch(); } };
    window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true);
  }, [boot?.platform, active?.kind]);
  return <UIProvider theme={theme}><div className="workspace">
    <ResizableWorkspace hideToolbar rightToggleRef={panelToggle} rightOpen={reviewOpen} onRightOpenChange={setReviewOpen}
      labels={{ left: '项目', right: '检查器', show: '显示', hide: '收起', resize: side => side === 'left' ? '调整项目栏宽度' : '调整检查器宽度', compact: '空间足够时自动恢复面板', hint: '拖动边缘或使用方向键调整宽度' }}
      left={<ProjectSidebar sessions={sessions} recentProjects={boot?.preferences.recentProjects ?? []} activeId={activeId} activeProject={project} creatingProject={launch.creatingProject} runtimeAvailable={!!boot?.runtime} onSelectProject={navigation.selectProject} onNewConversation={cwd => void launch.newConversation(cwd)} onSelectSession={navigation.selectSession} onCloseSession={id => void workspace.closeSession(id)} onRenameSession={navigation.renameSession} onForkSession={(id, entryId) => void desktopClient.forkChatSession(id, entryId)} onSearch={palette.openFromSidebar} onSettings={desktopPresentation.showSettings}/>} 
      right={active ? <GitPanel key={active.id} sessionId={active.id} onClose={closeReview} onReference={input.reference}/> : <div className="inspector-placeholder ui-meta">选择会话以查看文件与 Git</div>}>
      {error && <div className="error-banner" role="alert"><span>{error}</span><Button aria-label="关闭错误提示" onClick={desktopPresentation.dismissError}>×</Button></div>}
      {!active && project ? <PendingChatPane cwd={project} runtimeAvailable={!!boot?.runtime} value={input.readProjectDraft(project)} onValueChange={text => input.replaceProjectDraft(project, text)} onStart={(text, trust) => navigation.startProjectConversation(project, text, trust)} onSettings={desktopPresentation.showSettings}/> : !active && <section className="workspace-blank"><Icon name="chat"/><h1>{launch.creatingProject ? '正在创建对话…' : '开始一个新对话'}</h1><p>{boot?.runtimeError || '从左侧选择项目进入新的对话草稿；发送第一条消息后才会创建历史。'}</p></section>}
      {active && <div className="session-toolbar"><Breadcrumbs label="当前位置" items={[{ id: active.cwd, label: projectName(active.cwd), onSelect: () => navigation.selectProject(active.cwd) }, { id: active.id, label: active.title }]}/><div><Button variant="ghost" onClick={() => sessionActions.openProject(active.id)}>打开目录</Button>{active.kind === 'chat' && <Button variant="ghost" onClick={() => launch.open({ cwd: active.cwd, kind: 'terminal', mode: 'new' })}>兼容终端</Button>}{active.kind === 'terminal' && <><Button variant="ghost" onClick={() => input.toggleSearch()}>搜索</Button><Button variant="ghost" onClick={() => void input.chooseTerminalReferences()}>＋ 文件引用</Button></>}<Button ref={panelToggle} variant="ghost" aria-expanded={reviewOpen} onClick={() => setReviewOpen(open => !open)}>{reviewOpen ? '收起' : '显示'} 检查器</Button></div></div>}
      {active?.kind === 'terminal' && input.searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); input.find(); }}><input className="ui-input" autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={input.searchText} onChange={event => { input.editSearch(event.target.value); }} /><span>{!input.found && '未找到'}</span><Button type="button" onClick={() => input.find(true)}>↑</Button><Button type="submit">↓</Button><Button type="button" onClick={() => { input.closeSearch(); }}>×</Button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}><div className="interaction-column"><div className="session-stage">{sessions.map(session => session.kind === 'terminal' ? <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} theme={theme} platform={boot?.platform ?? ''} onReady={input.onTerminalReady} onExit={workspace.markSessionExited} onError={desktopPresentation.reportError} /> : <ChatPane key={session.id} session={session} active={session.id === activeId} draft={input.readDraft(session.id)} initialMessage={input.readInitialSend(session.id)} onInitialMessageSent={() => input.clearInitialSend(session.id)} onDraftChange={text => input.replaceDraft(session.id, text)} onError={desktopPresentation.reportError} onTerminalRecovery={() => { launch.open({ cwd: session.cwd, kind: 'terminal', mode: 'new' }); }} onCommands={commands => palette.onCommands(session.id, commands)} />)}</div></div></div>
      {active?.kind === 'terminal' && <footer className="terminal-footer">兼容终端 · TUI 快捷键以 /hotkeys 为准 · {active.processStatus === 'exited' ? '进程已退出' : '独占会话'}</footer>}
    </ResizableWorkspace>
    {launch.isOpen && boot && <NewSessionDialog initialPath={launch.initialPath} initialKind={launch.initialKind} initialMode={launch.initialMode} hasRuntime={!!boot.runtime} onClose={launch.close} onCreate={launch.create} onSettings={launch.showSettings} />}
    {desktopPresentation.settingsOpen && boot && <SettingsDialog boot={boot} onClose={desktopPresentation.closeSettings} onSave={desktopPresentation.publish} />}
    <CommandPalette palette={palette} onInsert={input.insertCommand} />
  </div></UIProvider>;
}

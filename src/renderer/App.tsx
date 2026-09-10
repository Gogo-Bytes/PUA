import { useEffect, useRef, useState } from 'react';
import type { Bootstrap } from '../shared/contracts';
import type { ProjectTrust, SessionKind } from '../shared/chat';
import { TerminalPane, type TerminalHandle } from './TerminalPane';
import { referencePaths } from './terminal-keys';
import { ChatPane } from './ChatPane';
import { GitPanel } from './GitPanel';
import { useWorkspace, projectName } from './features/workspace';
import { NewSessionDialog } from './features/session-launch';
import { SettingsDialog } from './features/preferences';
import { CommandPalette, useCommandPalette } from './features/command-palette';
import { ProjectNavigation, SessionTabs } from './WorkspaceNavigation';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { useTheme } from './theme';

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState('');
  const [launch, setLaunch] = useState<{ cwd: string; kind: SessionKind; mode: 'new' | 'continue' }> ();
  const [newSession, setNewSession] = useState(false); const [settings, setSettings] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false); const [searchText, setSearchText] = useState(''); const [found, setFound] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [reviewOpen, setReviewOpen] = useState(() => window.innerWidth > 1100); const [renaming, setRenaming] = useState(false);
  const theme = useTheme(boot?.preferences.theme);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const closeReview = () => { setReviewOpen(false); panelToggle.current?.focus(); };
  const handles = useRef(new Map<string, TerminalHandle>());

  useEffect(() => { if (!window.desktop) { setError('请使用 npm run dev 启动桌面应用。'); return; } void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error))); }, []);
  const workspace = useWorkspace(window.desktop, {
    onClosed: id => setDrafts(current => { const next = { ...current }; delete next[id]; return next; }),
    onError: setError,
  });
  const { sessions, activeId, active, project, projectSessions } = workspace;
  const palette = useCommandPalette(active);
  const setActiveId = (id: string) => { workspace.selectSession(id); setSearchOpen(false); };
  const draft = activeId ? drafts[activeId] || '' : '';
  const setDraft = (text: string) => { if (activeId) setDrafts(current => ({ ...current, [activeId]: text })); };
  const handle = () => activeId ? handles.current.get(activeId) : undefined;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey; if (event.isComposing || event.keyCode === 229) return; if (modifier && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); palette.toggle(); } if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active?.kind === 'terminal') { event.preventDefault(); setSearchOpen(value => !value); } };
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

  const insert = (text: string) => { if (active?.kind === 'chat') setDraft(draft ? `${draft}\n${text}` : text); else handle()?.paste(text); palette.dismissAfterInsert(); };
  const create = async (cwd: string, kind: SessionKind, startMode: 'new' | 'continue' | 'resume', projectTrust: ProjectTrust) => {
    const session = await window.desktop.createSession({ cwd, kind, startMode, projectTrust, cols: 100, rows: 30 });
    workspace.addCreatedSession(session); setNewSession(false); setLaunch(undefined); setSearchOpen(false);
    void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error)));
  };
  const attachTerminal = async () => { try { const paths = await window.desktop.chooseAttachments(); if (paths.length) insert(referencePaths(paths)); } catch (error) { setError(String(error)); } };
  const rename = async (title: string) => { if (!active) return; if (active.kind === 'chat') await window.desktop.renameChatSession(active.id, title); workspace.setSessionTitle(active.id, title); setRenaming(false); };

  return <div className="workspace">
    <aside className="sidebar" aria-label="项目导航"><div className="brand"><span className="brand-icon"><Icon name="pi" /></span><strong>PUA</strong><small>工作台</small></div>
      <button className="search-launch" onClick={palette.openFromSidebar} disabled={!active}><Icon name="search" />搜索与命令<kbd>⌘ K</kbd></button>
      <button className="new-button" onClick={() => setNewSession(true)} disabled={!boot}><Icon name="plus" />打开项目</button>
      <ProjectNavigation sessions={sessions} recentProjects={boot?.preferences.recentProjects ?? []} project={project} onSelect={cwd => { workspace.selectProject(cwd); setSearchOpen(false); }} />
      <div className="sidebar-bottom"><div className="connection"><span className={`status-dot ${boot?.runtime ? 'running' : 'exited'}`} /><span>{boot?.runtime ? '本机 Pi' : '尚未连接 Pi'}</span></div><button className="settings-button" onClick={() => setSettings(true)} disabled={!boot}><Icon name="settings" />桌面设置</button></div>
    </aside>
    <main><header className="topbar"><SessionTabs sessions={projectSessions} activeId={activeId} onSelect={setActiveId} onClose={id => void workspace.closeSession(id)} /><div className="topbar-actions"><button className="icon-button" aria-label="新建会话" title="新建会话" onClick={() => { if (project) setLaunch({ cwd: project, kind: 'chat', mode: 'new' }); setNewSession(true); }} disabled={!boot}><Icon name="plus" /></button><button ref={panelToggle} className="icon-button" aria-label="显示或收起检查区" title="文件与 Git 检查区" aria-expanded={reviewOpen && !!active} disabled={!active} onClick={() => setReviewOpen(value => !value)}><Icon name="panel" /></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      {!active && <section className="workspace-empty"><Icon name="chat" /><h1>{project ? projectName(project) : '打开项目，开始工作'}</h1>{project && <code>{project}</code>}<p>{project ? '此项目还没有打开的会话。新建对话或继续 Pi 保存的最近会话。' : '选择本机项目，与 Pi 对话。模型和工具仍由你的 Pi 管理。'}</p><div><button className="primary" onClick={() => setNewSession(true)} disabled={!boot}>{project ? '创建会话' : '打开项目'}</button>{project && <button onClick={() => { setLaunch({ cwd: project, kind: 'chat', mode: 'continue' }); setNewSession(true); }}>继续最近会话</button>}<button onClick={() => setSettings(true)} disabled={!boot}>桌面设置</button></div>{boot?.runtimeError && <p className="form-error" role="alert">{boot.runtimeError}</p>}</section>}
      {active && <div className="session-toolbar"><div title={active.cwd} className="project-path"><Icon name="folder" /> {active.cwd}</div><div><button onClick={() => setRenaming(true)}>重命名</button>{active.kind === 'chat' && <button onClick={() => { setLaunch({ cwd: active.cwd, kind: 'terminal', mode: 'new' }); setNewSession(true); }}>兼容终端</button>}<button onClick={() => void window.desktop.openProject(active.id).catch(error => setError(String(error)))}>打开目录</button>{active.kind === 'terminal' && <><button onClick={() => setSearchOpen(value => !value)}>搜索</button><button onClick={() => void attachTerminal()}>＋ 文件引用</button></>}</div></div>}
      {active?.kind === 'terminal' && searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); setFound(handle()?.search(searchText) ?? false); }}><input autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={searchText} onChange={event => { setSearchText(event.target.value); setFound(true); }} /><span>{!found && '未找到'}</span><button type="button" onClick={() => setFound(handle()?.search(searchText, true) ?? false)}>↑</button><button type="submit">↓</button><button type="button" onClick={() => { handle()?.clearSearch(); setSearchOpen(false); handle()?.focus(); }}>×</button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}><div className="interaction-column"><div className="session-stage">{sessions.map(session => session.kind === 'terminal' ? <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} theme={theme} platform={boot?.platform ?? ''} onReady={(id, value) => { if (value) handles.current.set(id, value); else handles.current.delete(id); }} onExit={workspace.markSessionExited} onError={setError} /> : <ChatPane key={session.id} session={session} active={session.id === activeId} draft={drafts[session.id] || ''} onDraftChange={text => setDrafts(current => ({ ...current, [session.id]: text }))} onError={setError} onTerminalRecovery={() => { setLaunch({ cwd: session.cwd, kind: 'terminal', mode: 'new' }); setNewSession(true); }} onCommands={commands => palette.onCommands(session.id, commands)} />)}</div></div>{active && reviewOpen && <GitPanel key={active.id} sessionId={active.id} onClose={closeReview} onReference={text => { if (active.kind === 'terminal') insert(text); else { setDraft(draft ? `${draft}\n${text}` : text); document.querySelector<HTMLTextAreaElement>('.chat-pane.active textarea')?.focus(); } if (window.innerWidth <= 1100) setReviewOpen(false); }} />}</div>
      {active?.kind === 'terminal' && <footer>兼容终端 · TUI 快捷键以 /hotkeys 为准 · {active.processStatus === 'exited' ? '进程已退出' : '独占会话'}</footer>}
    </main>
    {newSession && boot && <NewSessionDialog initialPath={launch?.cwd || project || boot.preferences.recentProjects[0] || boot.home} initialKind={launch?.kind} initialMode={launch?.mode} hasRuntime={!!boot.runtime} onClose={() => { setNewSession(false); setLaunch(undefined); }} onCreate={create} onSettings={() => { setNewSession(false); setSettings(true); }} />}
    {renaming && active && <RenameDialog title={active.title} persistent={active.kind === 'chat'} onClose={() => setRenaming(false)} onSave={rename} />}
    {settings && boot && <SettingsDialog boot={boot} onClose={() => setSettings(false)} onSave={setBoot} />}
    <CommandPalette palette={palette} onInsert={insert} />
  </div>;
}

function RenameDialog({ title, persistent, onClose, onSave }: { title: string; persistent: boolean; onClose(): void; onSave(title: string): Promise<void> }) { const [value, setValue] = useState(title); const [error, setError] = useState(''); return <Modal title="会话名称" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (value.trim()) void onSave(value.trim()).catch(error => setError(String(error))); }}><input autoFocus className="full-input" aria-label="会话显示名" value={value} onChange={event => setValue(event.target.value)} /><p className="muted">{persistent ? '原生对话会通过 Pi set_session_name 保存名称。' : '兼容终端只修改当前窗口标签；持久名称请在 Pi 中使用 /name。'}</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="submit" className="primary" disabled={!value.trim()}>保存名称</button></div></form></Modal>; }

import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, Preferences, SessionInfo } from '../shared/contracts';
import type { ChatCommand, ProjectTrust, SessionKind } from '../shared/chat';
import { TerminalPane, type TerminalHandle } from './TerminalPane';
import { referencePaths } from './terminal-keys';
import { ChatPane } from './ChatPane';
import { GitPanel } from './GitPanel';
import { addSession, selectProject, selectSession, removeSession, projectName, type SessionWorkspace } from './session-state';
import { ProjectNavigation, SessionTabs } from './WorkspaceNavigation';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { useTheme } from './theme';

const terminalCommands = [
  { name: 'model', label: '选择模型', description: '使用 Pi 原生模型选择器' }, { name: 'thinking', label: '思考强度', description: '选择推理等级' },
  { name: 'resume', label: '恢复历史', description: '打开 Pi 原生会话选择器' }, { name: 'tree', label: '会话分支', description: '查看会话树' },
  { name: 'settings', label: 'Pi 设置', description: '打开原生设置' }, { name: 'login', label: '登录提供商', description: '由 Pi 处理凭据' },
  { name: 'reload', label: '重新加载资源', description: '重新加载扩展和技能' }, { name: 'compact', label: '压缩上下文', description: '执行上下文压缩' },
  { name: 'hotkeys', label: '所有快捷键', description: '以当前 Pi 配置为准' },
];

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [sessionState, setSessionState] = useState<SessionWorkspace>({ sessions: [], activeId: null });
  const { sessions, activeId } = sessionState;
  const setSessions = (update: (current: SessionInfo[]) => SessionInfo[]) => setSessionState(current => ({ ...current, sessions: update(current.sessions) }));
  const setActiveId = (id: string) => { setSessionState(current => selectSession(current, id)); setSearchOpen(false); };
  const [error, setError] = useState('');
  const [launch, setLaunch] = useState<{ cwd: string; kind: SessionKind; mode: 'new' | 'continue' }> ();
  const [newSession, setNewSession] = useState(false); const [settings, setSettings] = useState(false); const [palette, setPalette] = useState(false); const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false); const [searchText, setSearchText] = useState(''); const [found, setFound] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); const [reviewOpen, setReviewOpen] = useState(() => window.innerWidth > 1100); const [renaming, setRenaming] = useState(false);
  const theme = useTheme(boot?.preferences.theme);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const closeReview = () => { setReviewOpen(false); panelToggle.current?.focus(); };
  const [chatCommands, setChatCommands] = useState<Record<string, ChatCommand[]>>({});
  const handles = useRef(new Map<string, TerminalHandle>());
  const active = sessions.find(session => session.id === activeId); const draft = activeId ? drafts[activeId] || '' : '';
  const setDraft = (text: string) => { if (activeId) setDrafts(current => ({ ...current, [activeId]: text })); };
  const project = sessionState.project ?? active?.cwd;
  const projectSessions = sessions.filter(session => session.cwd === project);
  const handle = () => activeId ? handles.current.get(activeId) : undefined;

  useEffect(() => { if (!window.desktop) { setError('请使用 npm run dev 启动桌面应用。'); return; } void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error))); }, []);
  useEffect(() => window.desktop?.onSessionEvent(event => {
    if (event.type === 'session-info') setSessions(current => current.map(session => session.id === event.id ? { ...session, title: event.title ?? session.title, processStatus: event.processStatus ?? session.processStatus, activity: event.activity ?? session.activity } : session));
    if (event.type === 'chat-state' && event.state.activity) setSessions(current => current.map(session => session.id === event.id ? { ...session, activity: event.state.activity! } : session));
    if (event.type === 'exit') setSessions(current => current.map(session => session.id === event.id ? { ...session, processStatus: 'exited', activity: 'idle', exitCode: event.exitCode } : session));
  }), []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey; if (event.isComposing || event.keyCode === 229) return; if (modifier && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 'p')) { event.preventDefault(); setPalette(value => !value); } if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active?.kind === 'terminal') { event.preventDefault(); setSearchOpen(value => !value); } };
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

  const insert = (text: string) => { if (active?.kind === 'chat') setDraft(draft ? `${draft}\n${text}` : text); else handle()?.paste(text); setPalette(false); setQuery(''); };
  const create = async (cwd: string, kind: SessionKind, startMode: 'new' | 'continue' | 'resume', projectTrust: ProjectTrust) => {
    const session = await window.desktop.createSession({ cwd, kind, startMode, projectTrust, cols: 100, rows: 30 });
    setSessionState(current => addSession(current, session)); setNewSession(false); setLaunch(undefined); setSearchOpen(false);
    void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error)));
  };
  const close = async (id: string) => { try { if (!await window.desktop.closeSession(id)) return; setSessionState(current => removeSession(current, id)); setDrafts(current => { const next = { ...current }; delete next[id]; return next; }); } catch (error) { setError(String(error)); } };
  const attachTerminal = async () => { try { const paths = await window.desktop.chooseAttachments(); if (paths.length) insert(referencePaths(paths)); } catch (error) { setError(String(error)); } };
  const rename = async (title: string) => { if (!active) return; if (active.kind === 'chat') await window.desktop.renameChatSession(active.id, title); setSessions(current => current.map(session => session.id === active.id ? { ...session, title } : session)); setRenaming(false); };

  const paletteCommands = active?.kind === 'chat' ? (chatCommands[active.id] ?? []).map(command => ({ ...command, label: `/${command.name}` })) : terminalCommands.map(command => ({ ...command, source: 'terminal' as const }));

  return <div className="workspace">
    <aside className="sidebar" aria-label="项目导航"><div className="brand"><span className="brand-icon"><Icon name="pi" /></span><strong>PUA</strong><small>工作台</small></div>
      <button className="search-launch" onClick={() => { setPalette(true); setQuery(''); }} disabled={!active}><Icon name="search" />搜索与命令<kbd>⌘ K</kbd></button>
      <button className="new-button" onClick={() => setNewSession(true)} disabled={!boot}><Icon name="plus" />打开项目</button>
      <ProjectNavigation sessions={sessions} recentProjects={boot?.preferences.recentProjects ?? []} project={project} onSelect={cwd => { setSessionState(current => selectProject(current, cwd)); setSearchOpen(false); }} />
      <div className="sidebar-bottom"><div className="connection"><span className={`status-dot ${boot?.runtime ? 'running' : 'exited'}`} /><span>{boot?.runtime ? '本机 Pi' : '尚未连接 Pi'}</span></div><button className="settings-button" onClick={() => setSettings(true)} disabled={!boot}><Icon name="settings" />桌面设置</button></div>
    </aside>
    <main><header className="topbar"><SessionTabs sessions={projectSessions} activeId={activeId} onSelect={setActiveId} onClose={id => void close(id)} /><div className="topbar-actions"><button className="icon-button" aria-label="新建会话" title="新建会话" onClick={() => { if (project) setLaunch({ cwd: project, kind: 'chat', mode: 'new' }); setNewSession(true); }} disabled={!boot}><Icon name="plus" /></button><button ref={panelToggle} className="icon-button" aria-label="显示或收起检查区" title="文件与 Git 检查区" aria-expanded={reviewOpen && !!active} disabled={!active} onClick={() => setReviewOpen(value => !value)}><Icon name="panel" /></button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      {!active && <section className="workspace-empty"><Icon name="chat" /><h1>{project ? projectName(project) : '打开项目，开始工作'}</h1>{project && <code>{project}</code>}<p>{project ? '此项目还没有打开的会话。新建对话或继续 Pi 保存的最近会话。' : '选择本机项目，与 Pi 对话。模型和工具仍由你的 Pi 管理。'}</p><div><button className="primary" onClick={() => setNewSession(true)} disabled={!boot}>{project ? '创建会话' : '打开项目'}</button>{project && <button onClick={() => { setLaunch({ cwd: project, kind: 'chat', mode: 'continue' }); setNewSession(true); }}>继续最近会话</button>}<button onClick={() => setSettings(true)} disabled={!boot}>桌面设置</button></div>{boot?.runtimeError && <p className="form-error" role="alert">{boot.runtimeError}</p>}</section>}
      {active && <div className="session-toolbar"><div title={active.cwd} className="project-path"><Icon name="folder" /> {active.cwd}</div><div><button onClick={() => setRenaming(true)}>重命名</button>{active.kind === 'chat' && <button onClick={() => { setLaunch({ cwd: active.cwd, kind: 'terminal', mode: 'new' }); setNewSession(true); }}>兼容终端</button>}<button onClick={() => void window.desktop.openProject(active.id).catch(error => setError(String(error)))}>打开目录</button>{active.kind === 'terminal' && <><button onClick={() => setSearchOpen(value => !value)}>搜索</button><button onClick={() => void attachTerminal()}>＋ 文件引用</button></>}</div></div>}
      {active?.kind === 'terminal' && searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); setFound(handle()?.search(searchText) ?? false); }}><input autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={searchText} onChange={event => { setSearchText(event.target.value); setFound(true); }} /><span>{!found && '未找到'}</span><button type="button" onClick={() => setFound(handle()?.search(searchText, true) ?? false)}>↑</button><button type="submit">↓</button><button type="button" onClick={() => { handle()?.clearSearch(); setSearchOpen(false); handle()?.focus(); }}>×</button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}><div className="interaction-column"><div className="session-stage">{sessions.map(session => session.kind === 'terminal' ? <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} theme={theme} platform={boot?.platform ?? ''} onReady={(id, value) => { if (value) handles.current.set(id, value); else handles.current.delete(id); }} onExit={(id, code) => setSessions(current => current.map(value => value.id === id ? { ...value, processStatus: 'exited', activity: 'idle', exitCode: code } : value))} onError={setError} /> : <ChatPane key={session.id} session={session} active={session.id === activeId} draft={drafts[session.id] || ''} onDraftChange={text => setDrafts(current => ({ ...current, [session.id]: text }))} onError={setError} onTerminalRecovery={() => { setLaunch({ cwd: session.cwd, kind: 'terminal', mode: 'new' }); setNewSession(true); }} onCommands={commands => setChatCommands(current => current[session.id] === commands ? current : { ...current, [session.id]: commands })} />)}</div></div>{active && reviewOpen && <GitPanel key={active.id} sessionId={active.id} onClose={closeReview} onReference={text => { if (active.kind === 'terminal') insert(text); else { setDraft(draft ? `${draft}\n${text}` : text); document.querySelector<HTMLTextAreaElement>('.chat-pane.active textarea')?.focus(); } if (window.innerWidth <= 1100) setReviewOpen(false); }} />}</div>
      {active?.kind === 'terminal' && <footer>兼容终端 · TUI 快捷键以 /hotkeys 为准 · {active.processStatus === 'exited' ? '进程已退出' : '独占会话'}</footer>}
    </main>
    {newSession && boot && <NewSessionDialog initialPath={launch?.cwd || project || boot.preferences.recentProjects[0] || boot.home} initialKind={launch?.kind} initialMode={launch?.mode} hasRuntime={!!boot.runtime} onClose={() => { setNewSession(false); setLaunch(undefined); }} onCreate={create} onSettings={() => { setNewSession(false); setSettings(true); }} />}
    {renaming && active && <RenameDialog title={active.title} persistent={active.kind === 'chat'} onClose={() => setRenaming(false)} onSave={rename} />}
    {settings && boot && <SettingsDialog boot={boot} onClose={() => setSettings(false)} onSave={setBoot} />}
    {palette && active && <Modal title={active.kind === 'chat' ? 'Pi 命令' : '终端命令'} onClose={() => setPalette(false)}><input autoFocus className="full-input" aria-label="搜索命令" placeholder="搜索扩展、提示模板或技能…" value={query} onChange={event => setQuery(event.target.value)} /><p className="muted">{active.kind === 'chat' ? '仅显示 Pi RPC 可调用的扩展命令、提示模板和技能；设置、登录与历史选择请使用兼容终端。' : '选择后只插入到 Pi TUI，不自动执行。'}</p><div className="command-list" onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(event.target as HTMLButtonElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } }}>{!paletteCommands.length && <p className="muted">当前 Pi 没有提供可调用命令。登录与设置请使用兼容终端。</p>}{paletteCommands.filter(command => `${command.label}${command.name}${command.description || ''}`.toLowerCase().includes(query.toLowerCase())).map(command => <button key={command.name} onClick={() => insert(`/${command.name}`)}><div>{command.label}<small>{command.description || command.source}</small></div><code>/{command.name}</code></button>)}</div></Modal>}
  </div>;
}

export function NewSessionDialog({ initialKind = 'chat', initialMode = 'new', initialPath, hasRuntime, onClose, onCreate, onSettings }: { initialKind?: SessionKind; initialMode?: 'new' | 'continue'; initialPath: string; hasRuntime: boolean; onClose(): void; onCreate(cwd: string, kind: SessionKind, mode: 'new' | 'continue' | 'resume', trust: ProjectTrust): Promise<void>; onSettings(): void }) {
  const [cwd, setCwd] = useState(initialPath); const [kind, setKind] = useState<SessionKind>(initialKind); const [mode, setMode] = useState<'new' | 'continue' | 'resume'>(initialMode); const [trust, setTrust] = useState<ProjectTrust>('default'); const [inspection, setInspection] = useState<{ cwd: string; paths: string[]; error?: string }>(); const resources = inspection?.cwd === cwd ? inspection.paths : []; const inspecting = inspection?.cwd !== cwd; const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    let current = true; setTrust('default');
    const timer = setTimeout(() => {
      if (cwd.trim()) void window.desktop.inspectProjectResources(cwd).then(value => { if (current) setInspection({ cwd, paths: value.paths }); }).catch(error => { if (current) setInspection({ cwd, paths: [], error: String(error) }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [cwd]);
  useEffect(() => { if (kind === 'chat' && mode === 'resume') setMode('new'); }, [kind]);
  return <Modal title="打开项目" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (busy || (kind === 'chat' && (inspecting || inspection?.error))) return; setBusy(true); void onCreate(cwd, kind, mode, trust).catch(error => { setError(String(error)); setBusy(false); }); }}><label>项目文件夹</label><div className="input-row"><input aria-label="项目文件夹" autoFocus value={cwd} onChange={event => setCwd(event.target.value)} required /><button type="button" onClick={() => void window.desktop.chooseDirectory().then(value => { if (value) setCwd(value); }).catch(error => setError(String(error)))}>浏览…</button></div><label>界面</label><div className="mode-options">{([['chat', '原生对话', '默认 · RPC 消息与工具卡片'], ['terminal', '兼容终端', '登录、设置和 TUI 专属扩展']] as const).map(([value, label, hint]) => <label key={value} className={kind === value ? 'chosen' : ''}><input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} /><span>{label}<small>{hint}</small></span></label>)}</div><label>启动方式</label><div className="mode-options">{([['new', '新会话', '开启独立会话'], ['continue', '继续最近', '恢复本项目最近会话'], ...(kind === 'terminal' ? [['resume', '选择历史', 'Pi 原生选择器'] as const] : [])] as const).map(([value, label, hint]) => <label key={value} className={mode === value ? 'chosen' : ''}><input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)} /><span>{label}<small>{hint}</small></span></label>)}</div>{kind === 'chat' && resources.length > 0 && <><label>检测到项目资源</label><div className="trust-options">{([['default', '沿用 Pi 已保存决定 / 全局默认'], ['approve', '本次信任并加载项目资源'], ['decline', '本次不加载项目资源']] as const).map(([value, label]) => <label key={value}><input type="radio" name="trust" checked={trust === value} onChange={() => setTrust(value)} />{label}</label>)}</div><p className="muted">RPC 不会显示 Pi 内置信任提示。PUA 不读取或修改 trust.json；“本次信任/不加载”只向这个进程传递对应参数。</p></>}<p className="muted">兼容终端可在内部切换任意历史，因此必须独占：请先关闭其他会话，等待进程退出后再打开。</p>{kind === 'chat' && inspecting && <p>正在检查项目资源…</p>}{(error || inspection?.error) && <p role="alert" className="form-error">{error || inspection?.error}</p>}<div className="modal-actions">{!hasRuntime ? <button type="button" className="primary" onClick={onSettings}>先配置 Pi</button> : <button type="submit" className="primary" disabled={busy || !cwd.trim() || (kind === 'chat' && (inspecting || !!inspection?.error))}>{busy ? '正在打开…' : kind === 'chat' ? '开始对话 ↗' : '打开兼容终端 ↗'}</button>}</div></form></Modal>;
}
function RenameDialog({ title, persistent, onClose, onSave }: { title: string; persistent: boolean; onClose(): void; onSave(title: string): Promise<void> }) { const [value, setValue] = useState(title); const [error, setError] = useState(''); return <Modal title="会话名称" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (value.trim()) void onSave(value.trim()).catch(error => setError(String(error))); }}><input autoFocus className="full-input" aria-label="会话显示名" value={value} onChange={event => setValue(event.target.value)} /><p className="muted">{persistent ? '原生对话会通过 Pi set_session_name 保存名称。' : '兼容终端只修改当前窗口标签；持久名称请在 Pi 中使用 /name。'}</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="submit" className="primary" disabled={!value.trim()}>保存名称</button></div></form></Modal>; }
function SettingsDialog({ boot, onClose, onSave }: { boot: Bootstrap; onClose(): void; onSave(value: Bootstrap): void }) { const [value, setValue] = useState<Preferences>(boot.preferences); const [args, setArgs] = useState(JSON.stringify(value.args)); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const pick = async (key: 'piPath' | 'nodePath') => { try { const selected = await window.desktop.chooseFile(); if (selected) setValue(current => ({ ...current, [key]: selected })); } catch (error) { setError(String(error)); } }; return <Modal title="桌面设置" onClose={onClose}><form onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); try { const parsed: unknown = JSON.parse(args); if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) throw new Error('参数必须是 JSON 字符串数组'); void window.desktop.savePreferences({ ...value, args: parsed }).then(result => { onSave(result); if (result.runtimeError) { setError(result.runtimeError); setBusy(false); } else onClose(); }).catch(error => { setError(String(error)); setBusy(false); }); } catch (error) { setError(String(error)); setBusy(false); } }}><p className="muted">这里只管理桌面外壳。模型、凭据、工具和扩展继续由 Pi 配置。聊天模式的 mode/session/trust 参数由打开项目界面控制。</p><label>外观</label><div className="theme-options" role="group" aria-label="外观主题">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([theme, label]) => <button type="button" key={theme} aria-pressed={(value.theme ?? 'system') === theme} onClick={() => setValue(current => ({ ...current, theme }))}>{label}</button>)}</div><p className="muted">保存后应用于工作台与终端，不重启会话。</p><label>Pi 可执行文件 / CLI .js 路径</label><div className="input-row"><input aria-label="Pi 路径" value={value.piPath} onChange={event => setValue({ ...value, piPath: event.target.value })} /><button type="button" onClick={() => void pick('piPath')}>选择…</button></div><label>Node.js 可执行文件（可选）</label><div className="input-row"><input aria-label="Node.js 路径" value={value.nodePath} onChange={event => setValue({ ...value, nodePath: event.target.value })} /><button type="button" onClick={() => void pick('nodePath')}>选择…</button></div><label>附加 Pi CLI 参数 · JSON 字符串数组</label><input className="full-input mono" aria-label="Pi CLI 参数" value={args} onChange={event => setArgs(event.target.value)} /><label>终端字号 <output>{value.fontSize}px</output></label><input className="range" aria-label="终端字号" type="range" min="10" max="28" value={value.fontSize} onChange={event => setValue({ ...value, fontSize: Number(event.target.value) })} /><div className="runtime-card"><span>当前检测到的 Pi</span><code>{boot.runtime?.source || '未检测到'}</code><small>路径与参数修改仅影响新会话。</small></div>{error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button></div></form></Modal>; }

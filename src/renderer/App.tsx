import { useEffect, useRef, useState } from 'react';
import type { Bootstrap, Preferences, SessionInfo } from '../shared/contracts';
import { TerminalPane, type TerminalHandle } from './TerminalPane';
import { referencePaths } from './terminal-keys';
import { GitPanel } from './GitPanel';
import { removeSession, type SessionWorkspace } from './session-state';

const commands = [
  { command: '/model', label: '选择模型', description: '使用 Pi 已配置的提供商与模型' },
  { command: '/thinking', label: '思考强度', description: '选择当前模型支持的推理等级' },
  { command: '/resume', label: '恢复历史', description: '打开 Pi 原生会话选择器' },
  { command: '/tree', label: '会话分支', description: '查看完整会话树并切换分支' },
  { command: '/fork', label: '创建分支', description: '从历史用户消息创建新会话' },
  { command: '/session', label: '用量与会话', description: '查看 token、费用和会话文件' },
  { command: '/settings', label: 'Pi 设置', description: '保留原生设置与扩展行为' },
  { command: '/login', label: '登录提供商', description: '由 Pi 处理 OAuth / API 凭据' },
  { command: '/reload', label: '重新加载资源', description: '重新加载扩展、技能和提示模板' },
  { command: '/compact', label: '压缩上下文', description: '由 Pi 执行原生上下文压缩' },
  { command: '/export', label: '导出会话', description: '使用 Pi 原生导出功能' },
  { command: '/hotkeys', label: '所有快捷键', description: '以你的 Pi 配置为准' },
];
const basename = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) || value;

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [sessionState, setSessionState] = useState<SessionWorkspace>({ sessions: [], activeId: null });
  const { sessions, activeId } = sessionState;
  const setSessions = (update: (current: SessionInfo[]) => SessionInfo[]) => setSessionState(current => ({ ...current, sessions: update(current.sessions) }));
  const setActiveId = (id: string) => setSessionState(current => ({ ...current, activeId: current.sessions.some(session => session.id === id) ? id : current.activeId }));
  const [error, setError] = useState('');
  const [newSession, setNewSession] = useState(false);
  const [settings, setSettings] = useState(false);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [found, setFound] = useState(true);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sessionFilter, setSessionFilter] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const handles = useRef(new Map<string, TerminalHandle>());
  const active = sessions.find(session => session.id === activeId);
  const scratch = activeId ? drafts[activeId] || '' : '';
  const setScratch = (text: string) => { if (activeId) setDrafts(current => ({ ...current, [activeId]: text })); };
  const visibleSessions = sessions.filter(session => `${session.title} ${session.cwd}`.toLowerCase().includes(sessionFilter.toLowerCase()));
  const handle = () => activeId ? handles.current.get(activeId) : undefined;

  useEffect(() => {
    if (!window.desktop) { setError('请使用 npm run dev 启动桌面应用。本页面不模拟 Pi 连接。'); return; }
    void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error)));
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const modifier = boot?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setPalette(value => !value); }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && active) { event.preventDefault(); setSearchOpen(value => !value); }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [boot?.platform, activeId]);

  const insert = (text: string) => { handle()?.paste(text); setPalette(false); setQuery(''); };
  const create = async (cwd: string, mode: 'new' | 'continue' | 'resume') => {
    const session = await window.desktop.createSession({ cwd, mode, cols: 100, rows: 30 });
    setSessions(current => [...current, session]); setActiveId(session.id); setNewSession(false);
    void window.desktop.bootstrap().then(setBoot).catch(error => setError(String(error)));
  };
  const close = async (id: string) => {
    try {
      if (!await window.desktop.closeSession(id)) return;
      setSessionState(current => removeSession(current, id));
      setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    } catch (error) { setError(String(error)); }
  };
  const attach = async () => {
    try { const paths = await window.desktop.chooseAttachments(); if (paths.length) insert(referencePaths(paths)); }
    catch (error) { setError(String(error)); }
  };

  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">π</span><div>Pi Desktop<small>YOUR AGENT. YOUR WAY.</small></div><span className="version">0.2</span></div>
      <button className="new-button" onClick={() => setNewSession(true)} disabled={!boot}><span>＋</span> 打开项目<span className="button-hint">新会话</span></button>
      <div className="section-heading">工作中的会话 <span>{sessions.length.toString().padStart(2, '0')}</span></div>
      {sessions.length > 0 && <input className="session-filter" aria-label="筛选会话" placeholder="搜索会话或项目…" value={sessionFilter} onChange={event => setSessionFilter(event.target.value)} />}
      <nav className="sessions" aria-label="会话">
        {sessions.length === 0 && <p className="muted empty-list">还没有打开的会话。<br />选择一个项目，即可开始。</p>}
        {sessions.length > 0 && visibleSessions.length === 0 && <p className="muted empty-list">没有匹配的会话。</p>}
        {visibleSessions.map(session => <div key={session.id} className={`session-row ${session.id === activeId ? 'selected' : ''}`}>
          <button className="session-select" title={session.cwd} onClick={() => { setActiveId(session.id); setSearchOpen(false); }}>
            <span className={`status-dot ${session.status}`} /><span className="session-label">{session.title}<small>{session.status === 'exited' ? `进程已退出 · ${session.exitCode}` : session.cwd}</small></span>
          </button>
          <button className="close-session" aria-label={`关闭 ${session.title}`} onClick={() => void close(session.id)}>×</button>
        </div>)}
      </nav>
      {!!boot?.preferences.recentProjects.length && <><div className="section-heading">最近项目</div><div className="recent-list">{boot.preferences.recentProjects.slice(0, 7).map(project => <button key={project} title={project} onClick={() => void create(project, 'resume').catch(error => setError(String(error)))}><span>⌁</span>{basename(project)}<span className="recent-arrow">↗</span></button>)}</div></>}
      <div className="sidebar-bottom">
        <div className="connection"><span className={`status-dot ${boot?.runtime ? 'running' : 'exited'}`} /><div>{boot?.runtime ? '使用本机 Pi' : '尚未连接 Pi'}<small title={boot?.runtime?.source}>{boot?.runtime?.source || '在桌面设置中选择安装路径'}</small></div></div>
        <button className="settings-button" onClick={() => setSettings(true)} disabled={!boot}>⚙ <span>桌面设置</span><span>↗</span></button>
      </div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumbs">工作空间 <span>/</span> <strong>{active?.title || '开始'}</strong></div><div className="topbar-actions"><span className="native-badge">原生 Pi 内核</span><button onClick={() => { setPalette(true); setQuery(''); }} disabled={!active}>⌘ 命令面板</button></div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      {!active && <section className="welcome">
        <div className="welcome-mark">π<span /></div><div className="eyebrow">LESS FRICTION. SAME PI.</div>
        <h1>熟悉的 Pi。<br /><span>更顺手的工作空间。</span></h1>
        <p>你的模型、扩展、技能和工具，仍由 Pi 原生运行。<br />这里负责把项目和会话放在触手可及的地方。</p>
        <div className="welcome-actions"><button className="primary" onClick={() => setNewSession(true)} disabled={!boot}>打开一个项目 <span>↗</span></button><button onClick={() => setSettings(true)} disabled={!boot}>配置 Pi 路径</button></div>
        {boot?.runtimeError && <div className="setup-note">{boot.runtimeError}</div>}
        <div className="feature-grid"><article><span>01 / 原生能力</span><h3>不替你决定工作流</h3><p>不额外限制工具、命令或扩展。<br />沿用你的 Pi 配置与项目规则。</p></article><article><span>02 / 项目与会话</span><h3>随时切换，不打断任务</h3><p>每个标签是独立的 Pi 进程。<br />历史与分支继续由 Pi 保存。</p></article><article><span>03 / 兼容优先</span><h3>保留真实交互</h3><p>原生终端承载扩展自定义界面。<br />无需把 Pi 塞进简化的聊天框。</p></article></div>
        <div className="welcome-footnote">终端优先预览版 · 非完整原生聊天 GUI · 图片与平台兼容性见项目文档</div>
      </section>}
      {active && <div className="session-toolbar"><div title={active.cwd} className="project-path"><span>⌁</span> {active.cwd}</div><div><button onClick={() => setRenaming(true)}>重命名</button><button className={reviewOpen ? 'toolbar-selected' : ''} onClick={() => setReviewOpen(value => !value)}>变更审查</button><button onClick={() => void window.desktop.openProject(active.id).catch(error => setError(String(error)))} title="在文件管理器中打开">打开目录</button><button onClick={() => setSearchOpen(value => !value)}>搜索</button><button onClick={() => setScratchOpen(value => !value)}>草稿</button><button onClick={() => void attach()} disabled={active.status !== 'running'}>＋ 文件引用</button></div></div>}
      {active && searchOpen && <form className="search-bar" onSubmit={event => { event.preventDefault(); setFound(handle()?.search(searchText) ?? false); }}><input autoFocus aria-label="搜索终端历史" placeholder="搜索当前终端缓冲区…" value={searchText} onChange={event => { setSearchText(event.target.value); setFound(true); }} /><span>{!found && '未找到'}</span><button type="button" onClick={() => setFound(handle()?.search(searchText, true) ?? false)}>↑</button><button type="submit">↓</button><button type="button" onClick={() => { handle()?.clearSearch(); setSearchOpen(false); handle()?.focus(); }}>×</button></form>}
      <div className={`workbench ${!active ? 'hidden' : ''}`}>
      <div className="interaction-column">
      <div className="terminal-stage">
        {sessions.map(session => <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={boot?.preferences.fontSize ?? 14} platform={boot?.platform ?? ''} onReady={(id, value) => { if (value) handles.current.set(id, value); else handles.current.delete(id); }} onExit={(id, code) => setSessions(current => current.map(s => s.id === id ? { ...s, status: 'exited', exitCode: code } : s))} onError={setError} />)}
      </div>
      {active && scratchOpen && <div className="scratchpad"><div><span>多行草稿</span><small>只粘贴到当前 Pi 输入位置，不自动发送。确认 Pi 已处于消息编辑器后再粘贴。</small></div><textarea aria-label="多行草稿" placeholder="在这里整理需求，中文输入与多行编辑…" value={scratch} onChange={event => setScratch(event.target.value)} /><div><span className="muted">此会话独立草稿 · 仅保留在窗口内存中</span><button onClick={() => insert(scratch)} disabled={!scratch || active.status !== 'running'}>粘贴到 Pi ↗</button></div></div>}
      </div>
      {active && reviewOpen && <GitPanel key={active.id} sessionId={active.id} onClose={() => setReviewOpen(false)} onReference={text => { setScratch(scratch ? `${scratch}\n${text}` : text); setScratchOpen(true); }} />}
      </div>
      <footer><span><i className="status-dot running" /> {active ? (active.status === 'running' ? 'Pi 进程运行中' : '会话已退出') : '本地优先 · 不代理模型请求'}</span><span>{active ? 'Shift + Enter 换行 · 原生快捷键以 /hotkeys 为准' : '你掌握方向，Pi 负责执行。'}</span><button disabled={!active || active.status !== 'running'} title="发送原生 Escape 键，行为由 Pi 当前界面及按键配置决定" onClick={() => { if (activeId) window.desktop.write(activeId, '\x1b'); handle()?.focus(); }}>Esc</button></footer>
    </main>
    {newSession && boot && <NewSessionDialog initialPath={active?.cwd || boot.preferences.recentProjects[0] || boot.home} hasRuntime={!!boot.runtime} onClose={() => setNewSession(false)} onCreate={create} onSettings={() => { setNewSession(false); setSettings(true); }} />}
    {renaming && active && <RenameDialog title={active.title} onClose={() => setRenaming(false)} onSave={title => { setSessions(current => current.map(session => session.id === active.id ? { ...session, title } : session)); setRenaming(false); }} />}
    {settings && boot && <SettingsDialog boot={boot} onClose={() => setSettings(false)} onSave={value => setBoot(value)} />}
    {palette && active && <Modal title="命令面板" onClose={() => setPalette(false)}><input autoFocus className="full-input" aria-label="搜索命令" placeholder="搜索命令 / 模型 / 会话…" value={query} onChange={event => setQuery(event.target.value)} /><p className="muted">选择后仅插入命令，不自动执行。扩展命令请直接在 Pi 中输入 / 查找。</p><div className="command-list">{commands.filter(command => `${command.label}${command.command}${command.description}`.toLowerCase().includes(query.toLowerCase())).map(command => <button key={command.command} onClick={() => insert(command.command)}><div>{command.label}<small>{command.description}</small></div><code>{command.command}</code></button>)}</div></Modal>}
  </div>;
}

function Modal({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); onClose(); }}><header><h2>{title}</h2><button aria-label="关闭对话框" onClick={onClose}>×</button></header>{children}</dialog>;
}

function NewSessionDialog({ initialPath, hasRuntime, onClose, onCreate, onSettings }: { initialPath: string; hasRuntime: boolean; onClose(): void; onCreate(cwd: string, mode: 'new' | 'continue' | 'resume'): Promise<void>; onSettings(): void }) {
  const [cwd, setCwd] = useState(initialPath);
  const [mode, setMode] = useState<'new' | 'continue' | 'resume'>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="打开项目" onClose={onClose}><form onSubmit={event => { event.preventDefault(); setBusy(true); void onCreate(cwd, mode).catch(error => { setError(String(error)); setBusy(false); }); }}>
    <label>项目文件夹</label><div className="input-row"><input aria-label="项目文件夹" autoFocus value={cwd} onChange={event => setCwd(event.target.value)} required /><button type="button" onClick={() => void window.desktop.chooseDirectory().then(value => { if (value) setCwd(value); }).catch(error => setError(String(error)))}>浏览…</button></div>
    <label>启动方式</label><div className="mode-options">{([['new', '新会话', '开启独立 Pi 进程'], ['continue', '继续最近会话', 'Pi --continue'], ['resume', '选择历史会话', 'Pi --resume']] as const).map(([value, label, hint]) => <label key={value} className={mode === value ? 'chosen' : ''}><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} /><span>{label}<small>{hint}</small></span></label>)}</div>
    <p className="muted">使用本机 Pi 和现有配置。项目信任提示由 Pi 自己处理，桌面端不自动批准，也不额外添加限制。不要在多个进程中同时恢复同一历史会话。</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="modal-actions">{!hasRuntime ? <button type="button" className="primary" onClick={onSettings}>先配置 Pi</button> : <button type="submit" className="primary" disabled={busy || !cwd.trim()}>{busy ? '正在打开…' : '打开工作空间 ↗'}</button>}</div>
  </form></Modal>;
}

function RenameDialog({ title, onClose, onSave }: { title: string; onClose(): void; onSave(title: string): void }) {
  const [value, setValue] = useState(title);
  return <Modal title="会话显示名" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (value.trim()) onSave(value.trim()); }}><input autoFocus className="full-input" aria-label="会话显示名" value={value} onChange={event => setValue(event.target.value)} /><p className="muted">仅修改当前窗口的标签名称，不改写 Pi 原生会话。需要持久化 Pi 会话名时，请使用原生 /name 命令。</p><div className="modal-actions"><button type="submit" className="primary" disabled={!value.trim()}>保存显示名</button></div></form></Modal>;
}

function SettingsDialog({ boot, onClose, onSave }: { boot: Bootstrap; onClose(): void; onSave(value: Bootstrap): void }) {
  const [value, setValue] = useState<Preferences>(boot.preferences);
  const [args, setArgs] = useState(JSON.stringify(value.args));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (key: 'piPath' | 'nodePath') => { try { const selected = await window.desktop.chooseFile(); if (selected) setValue(current => ({ ...current, [key]: selected })); } catch (error) { setError(String(error)); } };
  return <Modal title="桌面设置" onClose={onClose}><form onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const parsed: unknown = JSON.parse(args);
      if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) throw new Error('参数必须是 JSON 字符串数组');
      void window.desktop.savePreferences({ ...value, args: parsed }).then(result => { onSave(result); if (result.runtimeError) { setError(result.runtimeError); setBusy(false); } else onClose(); }).catch(error => { setError(String(error)); setBusy(false); });
    } catch (error) { setError(String(error)); setBusy(false); }
  }}>
    <p className="muted">这里只管理桌面外壳。模型、凭据、工具和扩展继续在 Pi 中配置，不复制到桌面设置。</p>
    <label>Pi 可执行文件 / CLI .js 路径</label><div className="input-row"><input aria-label="Pi 路径" placeholder="留空自动查找 PATH / 常见安装目录" value={value.piPath} onChange={event => setValue({ ...value, piPath: event.target.value })} /><button type="button" onClick={() => void pick('piPath')}>选择…</button></div>
    <label>Node.js 可执行文件（可选）</label><div className="input-row"><input aria-label="Node.js 路径" placeholder="自动查找系统 Node.js" value={value.nodePath} onChange={event => setValue({ ...value, nodePath: event.target.value })} /><button type="button" onClick={() => void pick('nodePath')}>选择…</button></div>
    <label>附加 Pi CLI 参数 · JSON 字符串数组</label><input className="full-input mono" aria-label="Pi CLI 参数" value={args} onChange={event => setArgs(event.target.value)} placeholder='["--verbose"]' />
    <p className="muted">参数直接传给 Pi，不经过 shell。请勿在这里存 API key；沿用 Pi /login 或环境变量。使用交互模式，不要加入 --mode rpc / --print。</p>
    <label>终端字号 <output>{value.fontSize}px</output></label><input className="range" aria-label="终端字号" type="range" min="10" max="28" value={value.fontSize} onChange={event => setValue({ ...value, fontSize: Number(event.target.value) })} />
    <div className="runtime-card"><span>当前检测到的 Pi</span><code>{boot.runtime?.source || '未检测到'}</code><small>启动路径与参数修改仅影响新会话。不会改写 ~/.pi/agent。</small></div>
    {error && <p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button></div>
  </form></Modal>;
}

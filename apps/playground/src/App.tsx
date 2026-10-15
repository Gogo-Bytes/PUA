import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Code2, Moon, PanelLeft, RotateCcw, Sun } from 'lucide-react';
import { Sidebar, UIProvider, type SidebarSession } from '@pua/components';
import { createSeed, projectMenu } from './fixtures';

export function App() {
  const [seed] = useState(() => createSeed());
  const [projects, setProjects] = useState(seed.projects);
  const [sessions, setSessions] = useState(seed.sessions);
  const [recent, setRecent] = useState(seed.recent);
  const [expanded, setExpanded] = useState(['agent-pet', 'pua']);
  const [selectedProject, setSelectedProject] = useState<string | null>('pua');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [reject, setReject] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [dataState, setDataState] = useState('normal');
  const [generation, setGeneration] = useState(0);
  const [events, setEvents] = useState(['准备就绪 · 所有操作仅作用于本地内存']);
  const [editor, setEditor] = useState<{ id: string; title: string } | null>(null);
  const sequence = useRef(0);
  const version = useRef(0);
  const mounted = useRef(false);
  const timers = useRef(new Map<ReturnType<typeof setTimeout>, () => void>());
  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    return () => { mounted.current = false; for (const [timer, settle] of pendingTimers) { clearTimeout(timer); settle(); } pendingTimers.clear(); };
  }, []);
  function record(event: string) { setEvents(previous => [event, ...previous].slice(0, 8)); }
  async function perform(label: string, apply: () => void = () => {}) {
    const startedVersion = version.current, shouldReject = reject;
    record(`开始 · ${label}`);
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { timers.current.delete(timer); resolve(); }, 700);
      timers.current.set(timer, resolve);
    });
    if (!mounted.current || version.current !== startedVersion) throw new Error('演示已重置');
    if (shouldReject) { record(`失败 · ${label}`); throw new Error('模拟请求失败，请关闭“异步拒绝”后重试'); }
    apply(); record(`完成 · ${label}`);
  }
  function reset() {
    version.current++; setGeneration(value => value + 1);
    const next = createSeed();
    setProjects(next.projects); setSessions(next.sessions); setRecent(next.recent);
    setExpanded(['agent-pet', 'pua']); setSelectedProject('pua'); setSelectedSession(null); setEditor(null);
    setEvents(['已重置 · 所有操作仅作用于本地内存']); setReject(false); setDisabled(false); setDuplicate(false); setDataState('normal');
  }
  function removeSessions(ids: readonly string[]) {
    setSessions(previous => previous.filter(session => !ids.includes(session.id)));
    setProjects(previous => previous.map(project => ({ ...project, sessionIds: project.sessionIds.filter(id => !ids.includes(id)) })));
    setRecent(previous => previous.filter(id => !ids.includes(id)));
    setSelectedSession(previous => previous && ids.includes(previous) ? null : previous);
  }
  function createSession(projectId: string | null) {
    return perform(`新建会话 · ${projectId ?? '最近'}`, () => {
      const id = `new-${++sequence.current}`;
      const session: SidebarSession = { id, title: '新的对话', canPin: true, primaryAction: { id: 'archive', label: '归档聊天', kind: 'archive' } };
      setSessions(previous => [...previous, session]);
      if (projectId) {
        setProjects(previous => previous.map(project => project.id === projectId ? { ...project, sessionIds: [...project.sessionIds, id] } : project));
        setExpanded(previous => [...new Set([...previous, projectId])]);
      } else setRecent(previous => [id, ...previous]);
      setSelectedProject(projectId); setSelectedSession(id);
    });
  }
  function projectAction(id: string, action: string) {
    return perform(`项目 ${id} → ${action}`, () => {
      const project = projects.find(item => item.id === id);
      if (!project) return;
      if (action === 'pin') setProjects(previous => previous.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item));
      else if (action.startsWith('section:')) setProjects(previous => previous.map(item => item.id === id ? { ...item, section: item.section === action.slice(8) ? 'none' : action.slice(8), pinned: false } : item));
      else if (action === 'edit') { setEditor({ id, title: project.title }); setSelectedProject(id); setSelectedSession(null); }
      else if (action === 'read') setSessions(previous => previous.map(item => project.sessionIds.includes(item.id) ? { ...item, unread: false } : item));
      else if (action === 'archive') removeSessions(sessions.filter(item => project.sessionIds.includes(item.id) && item.primaryAction?.kind === 'archive').map(item => item.id));
      else if (action === 'remove') { setProjects(previous => previous.filter(item => item.id !== id)); setSelectedProject(previous => previous === id ? null : previous); setSelectedSession(previous => previous && project.sessionIds.includes(previous) ? null : previous); }
      // reveal/worktree/new-section deliberately emit intent only; never touch Finder, disk or Git.
    });
  }
  const activeSession = sessions.find(session => session.id === selectedSession);
  const activeProject = projects.find(project => project.id === selectedProject);
  const projection = projects.map(project => ({ ...project, menu: projectMenu(project, sessions) }));
  return <UIProvider theme={dark ? 'dark' : 'light'} className="lab-theme">
    <div className="lab">
      <header className="lab-header">
        <a className="lab-brand" href="/" aria-label="PUA 组件预览首页"><span className="lab-brand-mark"><PanelLeft size={16} /></span><strong>PUA</strong><span className="lab-header-divider" /><span>Component studies</span></a>
        <div className="lab-toolbar">
          <a href="/">状态图谱</a>
          <button type="button" onClick={() => setNarrow(value => !value)} aria-label={`侧栏宽度 ${narrow ? 240 : 332}px`}><PanelLeft size={14} /><span>{narrow ? '240' : '332'} px</span></button>
          <button type="button" onClick={() => setDark(value => !value)} aria-label={`主题 ${dark ? '深色' : '浅色'}`}>{dark ? <Moon size={14} /> : <Sun size={14} />}<span>{dark ? '深色' : '浅色'}</span></button>
          <button type="button" onClick={reset} aria-label="重置演示" title="重置演示"><RotateCcw size={14} /></button>
        </div>
      </header>
      <div className="lab-caption"><span><span className="lab-index">01</span> 项目与会话导航</span><span className="lab-caption-note">React · TypeScript · CSS</span></div>
      <div className="lab-window" style={{ gridTemplateColumns: `${narrow ? 240 : 332}px minmax(0, 1fr)` }}>
        <div className="lab-sidebar">
          <Sidebar key={generation} projects={dataState === 'empty' ? [] : projection} sessions={dataState === 'empty' ? [] : sessions}
            recentSessionIds={dataState === 'empty' ? [] : duplicate ? ['pua-render', ...recent] : recent} expandedProjectIds={expanded}
            selectedProjectId={selectedProject} selectedSessionId={selectedSession}
            loading={dataState === 'loading'} error={dataState === 'error' ? '项目加载失败，保留上一次数据' : undefined} disabled={disabled}
            onProjectExpandedChange={(id, next) => { setExpanded(previous => next ? [...new Set([...previous, id])] : previous.filter(value => value !== id)); }}
            onSelectProject={id => { setSelectedProject(id); setSelectedSession(null); setEditor(null); record(`选择项目 · ${id}`); }}
            onSelectSession={id => { setSelectedSession(id); const owner = projects.find(project => project.sessionIds.includes(id)); setSelectedProject(owner?.id ?? null); setEditor(null); record(`选择会话 · ${id}`); }}
            onNewSession={createSession} onProjectAction={projectAction}
            onPinSession={(id, next) => perform(`${next ? '置顶' : '取消置顶'} · ${id}`, () => setSessions(previous => previous.map(item => item.id === id ? { ...item, pinned: next } : item)))}
            onSessionPrimaryAction={(id, action) => perform(`${action} · ${id}`, () => removeSessions([id]))}
            onSearch={() => perform('搜索意图（未接入业务）')} onCommands={() => perform('命令意图（未接入业务）')} onSettings={() => perform('设置意图（未接入业务）')} />
        </div>
        <main className="lab-main">
          <div className="lab-breadcrumb"><span>Workspace</span><span>/</span><span>{activeProject?.title ?? '最近'}</span>{activeSession && <><span>/</span><strong>{activeSession.title}</strong></>}</div>
          <div className="lab-stage">
            <div className="lab-eyebrow"><span /> INDEPENDENT COMPONENTS</div>
            <h1>熟悉的交互，<br /><span>独立的组件。</span></h1>
            <p className="lab-description">项目、会话与上下文菜单。<br />保留桌面端的紧凑层次，为 Web 重新封装。</p>
            <div className="lab-package"><Code2 size={15} /><code>@pua/components</code><span>v0.1.0</span></div>
            {editor ? <form className="lab-editor" onSubmit={event => { event.preventDefault(); const title = editor.title.trim(); if (!title) return; setProjects(previous => previous.map(project => project.id === editor.id ? { ...project, title } : project)); record(`改名 · ${editor.id} → ${title}`); setEditor(null); }}>
              <label htmlFor="project-title">编辑项目名称</label>
              <div><input id="project-title" autoFocus required value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} /><button type="submit"><Check size={15} />保存</button><button type="button" onClick={() => setEditor(null)}>取消</button></div>
            </form> : <div className="lab-hints"><span><span className="lab-hint-number">1</span>悬停项目，打开更多菜单</span><span><span className="lab-hint-number">2</span>悬停会话，置顶或归档</span><span><span className="lab-hint-number">3</span>使用方向键与 <kbd>esc</kbd> 导航</span></div>}
            <a className="lab-source-note" href="https://github.com/Gogo-Bytes/PUA" target="_blank" rel="noreferrer">证据驱动重构 · 非原始源码导出<ArrowUpRight size={12} /></a>
          </div>
          <aside className="lab-inspector" aria-label="本地交互检查器">
            <div className="lab-inspector-top"><span><i /> 本地状态</span><details className="lab-options"><summary>演示选项<ChevronDown size={12} /></summary><div>
              <label><input type="checkbox" checked={reject} onChange={event => setReject(event.target.checked)} />异步拒绝</label>
              <label><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} />禁用交互</label>
              <label><input type="checkbox" checked={duplicate} onChange={event => setDuplicate(event.target.checked)} />重复会话投影</label>
              <label>数据状态<select aria-label="数据状态" value={dataState} onChange={event => setDataState(event.target.value)}><option value="normal">正常</option><option value="empty">空列表</option><option value="loading">加载中</option><option value="error">加载错误</option></select></label>
            </div></details></div>
            <p className="lab-event" aria-live="polite">{events[0]}</p>
            <details className="lab-event-history"><summary>事件记录 <span>{events.length}</span></summary><ol>{events.map((event, index) => <li key={`${index}:${event}`}>{event}</li>)}</ol><code>project: {selectedProject ?? 'null'} · session: {selectedSession ?? 'null'}</code></details>
          </aside>
        </main>
      </div>
      <footer className="lab-footer"><span>还原界面交互，不复制宿主业务</span><span>无网络业务请求 · 无持久化</span></footer>
    </div>
  </UIProvider>;
}

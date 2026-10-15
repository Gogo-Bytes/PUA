import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Moon, PanelLeft, RotateCcw, Sun } from 'lucide-react';
import { Sidebar, SessionRow, UIProvider } from '@pua/components';
import { stateCases, stateGroups, type StateCase, type StateGroup } from './state-cases';
import { projectMenu } from './fixtures';
import { resolveSessionPresentation, toSidebarSession, type StudySession as SidebarSession } from './study-presentation';

function inspectJSON(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item, 2);
}
interface Confirmation { id: string; title: string; settle: (accepted: boolean) => void }
interface ArchiveFocus { id: string; row: HTMLElement; fromSidebar: boolean; neighbor: HTMLElement | null }
function revealInPane(pane: HTMLElement, target: HTMLElement) {
  const bounds = pane.getBoundingClientRect(), row = target.getBoundingClientRect();
  if (row.top < bounds.top) pane.scrollTop += row.top - bounds.top;
  else if (row.bottom > bounds.bottom) pane.scrollTop += row.bottom - bounds.bottom;
}

/** Fixture/transactions live here, not in the reusable package. */
export function StateGallery() {
  const [dark, setDark] = useState(false), [narrow, setNarrow] = useState(false);
  const [category, setCategory] = useState<StateGroup | 'all'>('all');
  const [picked, setPicked] = useState(stateCases[1].id);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const sidebar = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const archiveFocus = useRef<ArchiveFocus | null>(null);
  const [expanded, setExpanded] = useState<string[]>(stateGroups.map(group => group.id));
  const [overrides, setOverrides] = useState<Record<string, Partial<SidebarSession>>>({});
  const [projectState, setProjectState] = useState<Record<string, { pinned?: boolean; section?: string }>>({});
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState(['状态样本已载入 · 未确认图形/动画为 Web 近似']);
  const [generation, setGeneration] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmRef = useRef<Confirmation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false), version = useRef(0);
  const jobs = useRef(new Map<string, object>());
  const timers = useRef(new Map<ReturnType<typeof setTimeout>, () => void>());
  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => { mounted.current = false; confirmRef.current?.settle(false); confirmRef.current = null; for (const [timer, settle] of pending) { clearTimeout(timer); settle(); } pending.clear(); };
  }, []);
  useEffect(() => { if (confirmation && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [confirmation]);
  useLayoutEffect(() => {
    const handoff = archiveFocus.current;
    if (!handoff) return;
    archiveFocus.current = null;
    // Do not steal focus from another control selected during the operation/commit.
    if (document.activeElement !== document.body && !handoff.row.contains(document.activeElement)) return;
    const card = [...(main.current?.querySelectorAll<HTMLElement>('[data-case-id]') ?? [])].find(node => node.dataset.caseId === handoff.id);
    const target = handoff.fromSidebar
      ? handoff.neighbor?.isConnected ? handoff.neighbor : sidebar.current?.querySelector<HTMLElement>('button:not(:disabled)')
      : card?.querySelector<HTMLElement>('.state-removed button');
    target?.focus({ preventScroll: true });
    const pane = sidebar.current?.querySelector<HTMLElement>('.pua-sidebar-scroll');
    if (target && pane?.contains(target)) revealInPane(pane, target);
  }, [archived]);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [category, generation]);
  useEffect(() => {
    const pane = sidebar.current?.querySelector<HTMLElement>('.pua-sidebar-scroll');
    if (!pane) return;
    const item = stateCases.find(entry => entry.id === picked)!;
    const target = [...pane.querySelectorAll<HTMLElement>('[data-session-id]')].find(node => node.dataset.sessionId === picked)
      ?? [...pane.querySelectorAll<HTMLElement>('[data-project-id]')].find(node => node.dataset.projectId === item.group);
    if (!target) return;
    revealInPane(pane, target);
  }, [picked, expanded, scrollRequest, category]);
  function chooseCategory(next: StateGroup | 'all') {
    setCategory(next);
    if (next !== 'all' && !stateCases.some(item => item.id === picked && item.group === next)) setPicked(stateCases.find(item => item.group === next)!.id);
  }
  function projectCase(item: StateCase) {
    setPicked(item.id); setExpanded(previous => [...new Set([...previous, item.group])]); setScrollRequest(value => value + 1);
  }
  function record(text: string) { setEvents(previous => [text, ...previous].slice(0, 8)); }
  function getSession(item: StateCase): SidebarSession { return { ...item.session, ...overrides[item.id] }; }
  async function perform(id: string, label: string, apply: () => void) {
    if (jobs.current.has(id)) throw new Error('同一示例已有操作正在进行');
    const job = {}, started = version.current;
    jobs.current.set(id, job); record(`开始 · ${label} · ${id}`);
    try {
      await new Promise<void>(resolve => { const timer = setTimeout(() => { timers.current.delete(timer); resolve(); }, 300); timers.current.set(timer, resolve); });
      if (!mounted.current || started !== version.current) return;
      apply(); record(`完成 · ${label} · ${id}`);
    } finally { if (jobs.current.get(id) === job) jobs.current.delete(id); }
  }
  function settleConfirmation(accepted: boolean) {
    const current = confirmRef.current;
    confirmRef.current = null; dialog.current?.close(); setConfirmation(null); current?.settle(accepted);
  }
  async function archiveSession(id: string) {
    const item = stateCases.find(entry => entry.id === id);
    if (!item) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-session-id]') : null;
    const originRow = origin?.dataset.sessionId === id ? origin : null;
    const fromSidebar = !!(originRow && sidebar.current?.contains(originRow));
    let neighbor: HTMLElement | null = null;
    if (originRow && fromSidebar) {
      const rows = [...(sidebar.current?.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])];
      const index = rows.indexOf(originRow);
      const candidates = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()];
      neighbor = candidates.map(row => row.querySelector<HTMLElement>('button:not(:disabled):not([aria-disabled="true"])')).find(Boolean)
        ?? originRow.closest('.pua-project-group')?.querySelector<HTMLElement>('[data-project-id] button:not(:disabled)') ?? null;
    }
    const session = getSession(item), started = version.current;
    const display = resolveSessionPresentation(session.presentation ?? {}, session);
    if (display.confirmArchive) {
      if (confirmRef.current) throw new Error('请先处理当前归档确认');
      const accepted = await new Promise<boolean>(settle => { const next = { id, title: session.title, settle }; confirmRef.current = next; setConfirmation(next); });
      if (!accepted || started !== version.current || !mounted.current) { if (mounted.current && started === version.current) record(`取消归档 · ${id}`); return; }
    }
    await perform(id, '归档（仅内存）', () => {
      if (originRow?.contains(document.activeElement)) archiveFocus.current = { id, row: originRow, fromSidebar, neighbor };
      setArchived(previous => new Set([...previous, id]));
    });
  }
  function pinSession(id: string, next: boolean) {
    return perform(id, next ? '置顶' : '取消置顶', () => setOverrides(previous => ({ ...previous, [id]: { ...previous[id], pinned: next } })));
  }
  function snoozeSession(id: string) {
    return perform(id, 'Snooze 意图（本地移除 attention）', () => {
      const item = stateCases.find(entry => entry.id === id)!;
      const signal = getSession(item).presentation;
      setOverrides(previous => ({ ...previous, [id]: { ...previous[id], presentation: { ...signal, attention: undefined } } }));
    });
  }
  function menuAction(id: string, action: string) {
    return perform(id, `${action} 意图（未接入主机）`, () => {});
  }
  function projectAction(id: string, action: string) {
    return perform(`project:${id}`, `${action} 项目菜单意图（仅本地示例）`, () => {
      if (action === 'pin') setProjectState(previous => ({ ...previous, [id]: { ...previous[id], pinned: !previous[id]?.pinned } }));
      else if (action.startsWith('section:')) setProjectState(previous => ({ ...previous, [id]: { ...previous[id], section: action.slice(8), pinned: false } }));
      // Gallery groups are fixed scenario categories, not real folders/projects.
      // Other menu actions record intent; the interactive view owns its own adapter.
    });
  }
  function restore(id: string) {
    setArchived(previous => { const next = new Set(previous); next.delete(id); return next; });
    const item = stateCases.find(entry => entry.id === id)!;
    setOverrides(previous => ({ ...previous, [id]: { ...previous[id], presentation: { ...getSession(item).presentation, archived: false } } }));
    record(`本地恢复 · ${id}`);
  }
  function reset() {
    version.current++; settleConfirmation(false); jobs.current.clear(); archiveFocus.current = null;
    setOverrides({}); setProjectState({}); setArchived(new Set()); setGeneration(value => value + 1);
    setCategory('all'); setExpanded(stateGroups.map(group => group.id)); setPicked(stateCases[1].id);
    setEvents(['已重置全部样本 · 未接入宿主业务']);
  }
  const visibleGroups = stateGroups.filter(group => category === 'all' || category === group.id);
  const visibleCases = stateCases.filter(item => category === 'all' || category === item.group);
  const sessions = visibleCases.filter(item => !archived.has(item.id)).map(getSession).flatMap(session => { const mapped = toSidebarSession(session); return mapped ? [mapped] : []; });
  const projects = visibleGroups.map(group => {
    const project = { id: group.id, title: group.title, sessionIds: sessions.filter(session => stateCases.find(item => item.id === session.id)?.group === group.id).map(session => session.id), section: projectState[group.id]?.section ?? 'work', pinned: projectState[group.id]?.pinned };
    return { ...project, menu: projectMenu(project, sessions) };
  });
  const inspectedCase = stateCases.find(item => item.id === picked)!;
  const inspectedSession = getSession(inspectedCase);
  const inspectedDisplay = resolveSessionPresentation(inspectedSession.presentation ?? {}, inspectedSession);
  return <UIProvider theme={dark ? 'dark' : 'light'} className="lab-theme">
    <div className="lab state-lab">
      <header className="lab-header">
        <a className="lab-brand" href="/" aria-label="PUA 状态图谱首页"><span className="lab-brand-mark"><PanelLeft size={16} /></span><strong>PUA</strong><span className="lab-header-divider" /><span>Session state studies</span></a>
        <div className="lab-toolbar">
          <a href="/?view=production">正式接入</a><a href="/?view=interactive">交互预览</a><a href="/?view=isolated">独立样本</a>
          <button type="button" onClick={() => setNarrow(value => !value)} aria-label={`侧栏宽度 ${narrow ? 240 : 332}px`}><PanelLeft size={14} /><span>{narrow ? '240' : '332'} px</span></button>
          <button type="button" onClick={() => setDark(value => !value)} aria-label={`主题 ${dark ? '深色' : '浅色'}`}>{dark ? <Moon size={14} /> : <Sun size={14} />}<span>{dark ? '深色' : '浅色'}</span></button>
          <button type="button" onClick={reset} aria-label="重置全部状态样本"><RotateCcw size={14} /></button>
        </div>
      </header>
      <div className="lab-caption"><span><span className="lab-index">02</span> 状态图谱 · {stateCases.length} 个具名场景</span><span className="lab-caption-note">静态证据 → Web 近似重构</span></div>
      <div className="lab-window" style={{ gridTemplateColumns: `${narrow ? 240 : 332}px minmax(0, 1fr)` }}>
        <div className="lab-sidebar" ref={sidebar}><Sidebar key={generation} projects={projects} sessions={sessions} recentSessionIds={[]} expandedProjectIds={expanded}
          selectedSessionId={picked} onProjectExpandedChange={(id, next) => setExpanded(previous => next ? [...new Set([...previous, id])] : previous.filter(value => value !== id))}
          onProjectAction={projectAction} onSelectSession={setPicked} onPinSession={pinSession} onSessionPrimaryAction={archiveSession} onSnoozeSession={snoozeSession} onSessionMenuAction={menuAction}
          labels={{ projects: '所有状态分类', recent: '当前样本', emptySessions: '该分类没有可见行' }} /></div>
        <main className="lab-main state-main" ref={main}>
          <div className="state-toolbar"><div><h1>Session 状态图谱</h1><p>执行、attention、未读、环境、身份与诊断是独立维度；没有虚构的完成勾号。</p></div>
            <label>分类<select aria-label="状态分类" value={category} onChange={event => chooseCategory(event.target.value as StateGroup | 'all')}><option value="all">全部 · {stateCases.length}</option>{stateGroups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label></div>
          <div className="state-limit-note">图标轮廓、chip 几何与 CSS 动画为 Lucide/Web 近似。Snooze 进度是静态样本，不是真实 deadline；订阅彩点仅在诊断开关启用时显示。查看样本不会改变 fixture 的 active 信号。项目菜单仅本地示例：置顶/分区可切换，其余记录意图。</div>
          <details className="state-inspector" open={inspectorOpen} onToggle={event => setInspectorOpen(event.currentTarget.open)}><summary>检查样本：{inspectedCase.title}</summary>
            <div className="state-json"><div><strong>Caller signals</strong><pre>{inspectJSON({ ...inspectedSession.presentation, unread: inspectedSession.unread, pinned: inspectedSession.pinned })}</pre></div><div><strong>Derived display</strong><pre>{inspectJSON({ callerRemoved: archived.has(picked), ...inspectedDisplay })}</pre></div></div>
          </details>
          <div className="state-sections">
            {visibleGroups.map(group => <section key={group.id} className="state-section" aria-label={group.title}>
              <h2><span>{group.title}</span><code>{group.source}</code></h2>
              <div className="state-grid">{visibleCases.filter(item => item.group === group.id).map((item, index) => {
                const session = getSession(item), display = resolveSessionPresentation(session.presentation ?? {}, session);
                const removed = archived.has(item.id) || !display.visible;
                return <article key={`${generation}:${item.id}`} className={`state-case ${picked === item.id ? 'is-picked' : ''}`} data-case-id={item.id}>
                  <header><span className="state-case-number">{String(index + 1).padStart(2, '0')}</span><button type="button" onClick={() => { setPicked(item.id); setInspectorOpen(true); }} aria-label={`检查 ${item.title}`}>{item.title}</button><code>{display.activity}</code></header>
                  <div className="state-case-row">{removed ? <div className="state-removed">Row 已移除；无 Archived badge <button type="button" onClick={() => restore(item.id)}>本地恢复</button></div> : <SessionRow session={toSidebarSession(session)!} selected={session.presentation?.active}
                    onSelect={() => setPicked(item.id)} onPin={next => pinSession(item.id, next)} onPrimaryAction={() => archiveSession(item.id)} onSnooze={() => snoozeSession(item.id)} onMenuAction={action => menuAction(item.id, action)} />}</div>
                  <p>{item.condition}</p><footer><span>{item.source}</span><button type="button" onClick={() => projectCase(item)}>在左侧检查</button></footer>
                </article>;
              })}</div>
            </section>)}
          </div>
          <aside className="state-events" aria-label="状态演示事件"><strong>仅本地内存</strong><p aria-live="polite">{events[0]}</p><details><summary>事件记录</summary><ol>{events.map((event, index) => <li key={`${index}:${event}`}>{event}</li>)}</ol></details></aside>
        </main>
      </div>
      <footer className="lab-footer"><span>来源：packages/components/SESSION-STATES.md</span><span>无时间显示 · 无宿主业务请求</span></footer>
      <dialog ref={dialog} className="state-confirm-dialog" aria-labelledby="archive-confirm-title" onCancel={event => { event.preventDefault(); settleConfirmation(false); }}>
        <h2 id="archive-confirm-title">确认归档？</h2><p>{confirmation?.title}</p><p>此会话仍在 Working 或附加 automation。这里只移除本地样本，不取消真实任务。</p>
        <div><button type="button" onClick={() => settleConfirmation(false)}>取消</button><button type="button" onClick={() => settleConfirmation(true)}>确认归档（仅内存）</button></div>
      </dialog>
    </div>
  </UIProvider>;
}

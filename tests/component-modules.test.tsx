/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import './component-preview/test-setup';
import { ProjectNav, ProjectSidebar, SessionTabs } from '../src/renderer/features/workspace';
import { FileRow, InspectorHeader } from '../src/renderer/features/change-review';
import { ChatMessage, ToolExecutionCard } from '../src/renderer/features/conversation';
import { UIProvider } from '../src/renderer/ui';
it('tool activity uses one disclosure and retains open details across status updates', () => {
  const action = vi.fn();
  const view = (status: 'running' | 'error') => <UIProvider motion="off"><ToolExecutionCard title="读取配置" status={status} labels={{ details: '详情', statuses: { running: '运行中', error: '读取失败' } }}><button onClick={action}>重试读取</button></ToolExecutionCard></UIProvider>;
  const { rerender } = render(view('running'));
  const trigger = screen.getByRole('button', { name: '读取配置 · 详情 · 运行中' });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  rerender(view('error'));
  expect(screen.getByRole('button', { name: '读取配置 · 详情 · 读取失败' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
  expect(action).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '读取配置 · 详情 · 读取失败' }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
it('ProjectNav keeps cwd as callback identity and only reveals duplicate paths on hover/focus', () => {
  const select = vi.fn();
  render(<UIProvider><ProjectNav projects={[{ name: 'Atlas', cwd: '/one/atlas', sessions: 2 }, { name: 'Atlas', cwd: '/two/atlas', sessions: 1 }, { name: 'Orbit', cwd: '/one/orbit', sessions: 0 }]} selectedCwd="/one/atlas" onSelect={select} onAdd={() => {}}/></UIProvider>);
  expect(screen.queryByText('/one/atlas')).toBeNull(); expect(screen.queryByText('/one/orbit')).toBeNull();
  const rows = screen.getAllByRole('button', { name: /Atlas/ }); fireEvent.focus(rows[1]); expect(screen.getByRole('tooltip').textContent).toBe('/two/atlas'); fireEvent.click(rows[1]); expect(select).toHaveBeenCalledWith('/two/atlas');
});
it('production sidebar nests sessions below their project without tab semantics', () => {
  const create = vi.fn(), select = vi.fn(), selectProject = vi.fn();
  render(<UIProvider><ProjectSidebar sessions={[{ id: 's1', cwd: '/one/app', title: '调查交互', kind: 'chat', processStatus: 'running', activity: 'idle' }]} recentProjects={['/one/app', '/two/empty']} activeId="s1" activeProject="/one/app" runtimeAvailable onNewConversation={create} onSelectProject={selectProject} onSelectSession={select} onCloseSession={vi.fn()} onRenameSession={vi.fn()} onSearch={vi.fn()} onSettings={vi.fn()}/></UIProvider>);
  expect(screen.queryByRole('tablist')).toBeNull(); expect(screen.queryByRole('tab')).toBeNull();
  expect(screen.getByRole('list', { name: 'app 的会话' }).contains(screen.getByRole('button', { name: '调查交互' }))).toBe(true);
  fireEvent.click(screen.getAllByTitle('/two/empty')[0]); expect(selectProject).toHaveBeenCalledWith('/two/empty'); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '调查交互' })); expect(select).toHaveBeenCalledWith('s1');
});
it('production sidebar collapses and restores a project session list', () => {
  render(<UIProvider><ProjectSidebar sessions={[{ id: 's1', cwd: '/one/app', title: '调查交互', kind: 'chat', processStatus: 'running', activity: 'idle' }]} recentProjects={['/one/app']} activeId="s1" activeProject="/one/app" runtimeAvailable onNewConversation={vi.fn()} onSelectSession={vi.fn()} onCloseSession={vi.fn()} onRenameSession={vi.fn()} onSearch={vi.fn()} onSettings={vi.fn()}/></UIProvider>);
  const collapse = screen.getByRole('button', { name: '折叠 app' });
  fireEvent.click(collapse); expect(screen.queryByRole('button', { name: '调查交互' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 app' })); expect(screen.getByRole('button', { name: '调查交互' })).toBeTruthy();
});
it('production sidebar renders nested history and forks the selected entry', () => {
  const fork = vi.fn();
  render(<UIProvider><ProjectSidebar sessions={[{ id: 's1', cwd: '/one/app', title: '调查交互', kind: 'chat', processStatus: 'running', activity: 'idle', sessionTree: [{ entryId: 'root', label: '根消息', children: [{ entryId: 'branch', label: '分支消息', children: [] }] }] }]} recentProjects={['/one/app']} activeId="s1" activeProject="/one/app" runtimeAvailable onNewConversation={vi.fn()} onSelectSession={vi.fn()} onCloseSession={vi.fn()} onRenameSession={vi.fn()} onForkSession={fork} onSearch={vi.fn()} onSettings={vi.fn()}/></UIProvider>);
  fireEvent.click(screen.getByRole('button', { name: /根消息/ })); expect(fork).toHaveBeenCalledWith('s1', 'root');
  fireEvent.click(screen.getByRole('button', { name: /分支消息/ })); expect(fork).toHaveBeenCalledWith('s1', 'branch');
  fireEvent.click(screen.getByRole('button', { name: '折叠分支' })); expect(screen.queryByRole('button', { name: /分支消息/ })).toBeNull();
});
it('SessionTabs separates selection from rename and passes the session id through its callback', () => {
  const select = vi.fn(), rename = vi.fn();
  render(<UIProvider><SessionTabs sessions={[{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]} activeId="a" onSelect={select} onRename={rename} onAdd={() => {}}/></UIProvider>);
  fireEvent.click(screen.getByRole('tab', { name: 'Two' })); expect(select).toHaveBeenCalledWith('b'); expect(rename).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Two' }), { key: 'F2' }); fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } }); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); expect(rename).not.toHaveBeenCalled();
});
it.each(['Home', 'ArrowLeft', 'ArrowRight'])('SessionTabs %s finds the first session editor by identity while retaining its draft', key => {
  const select = vi.fn();
  const props = { sessions: [{ id: 'a"odd', title: 'One' }, { id: 'b', title: 'Two' }], onSelect: select, onRename: vi.fn(), onAdd: vi.fn() };
  const view = render(<UIProvider><SessionTabs {...props} activeId={'a"odd'}/></UIProvider>);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'F2' });
  const editor = screen.getByRole('textbox') as HTMLInputElement;
  fireEvent.change(editor, { target: { value: 'Retained draft' } });
  const second = screen.getByRole('tab', { name: 'Two' }); second.focus(); fireEvent.click(second);
  view.rerender(<UIProvider><SessionTabs {...props} activeId="b"/></UIProvider>);
  fireEvent.keyDown(second, { key });
  expect(select).toHaveBeenLastCalledWith('a"odd'); expect(document.activeElement).toBe(editor); expect(editor.value).toBe('Retained draft');
  // End also resolves by identity, not the shortened set of remaining tabs.
  second.focus(); fireEvent.keyDown(second, { key: 'End' });
  expect(select).toHaveBeenLastCalledWith('b'); expect(document.activeElement).toBe(second);
});
it.each(['Save', 'Cancel'])('SessionTabs isolates all navigation keys on editor %s', label => {
  const select = vi.fn();
  render(<UIProvider><SessionTabs sessions={[{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]} activeId="a" onSelect={select} onRename={vi.fn()} onAdd={vi.fn()}/></UIProvider>);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'F2' });
  const button = screen.getByRole('button', { name: label }); button.focus();
  for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) fireEvent.keyDown(button, { key });
  expect(select).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button); expect(screen.getByRole('textbox')).toBeTruthy();
});
it('SessionTabs can focus a pending editor by session id without enabling its busy controls', () => {
  const select = vi.fn();
  render(<UIProvider><SessionTabs sessions={[{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }]} activeId="b" onSelect={select} onRename={() => new Promise<void>(() => {})} onAdd={vi.fn()}/></UIProvider>);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'F2' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const second = screen.getByRole('tab', { name: 'Two' }); second.focus(); fireEvent.keyDown(second, { key: 'Home' });
  expect(select).toHaveBeenLastCalledWith('a');
  expect(document.activeElement).toBe(screen.getByRole('textbox').closest('.ui-rename-editor'));
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
});
it('ChatMessage treats HTML strings as text, exposes role/meta/streaming/failure/actions without desktop effects', () => {
  const action = vi.fn(); const unsafe = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const view = render(<UIProvider><ChatMessage role="assistant" author="小派" metadata="刚刚" streaming error="稍后重试" labels={{ assistant: '助手', streaming: '正在回复', failed: '回复失败' }} actions={<button onClick={action}>重试回复</button>}>{unsafe}</ChatMessage></UIProvider>);
  expect(screen.getByRole('article', { name: '助手' })).toBeTruthy(); expect(screen.getByText('刚刚')).toBeTruthy(); expect(screen.getByText('正在回复')).toBeTruthy(); expect(screen.getByText(unsafe)).toBeTruthy();
  expect(view.container.querySelector('img, script')).toBeNull(); expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试回复' })); expect(action).toHaveBeenCalledOnce();
});
it('module labels localize navigation, rename, execution and inspection without changing identity callbacks', () => {
  const open = vi.fn();
  render(<UIProvider><ProjectNav projects={[]} selectedCwd="" onSelect={vi.fn()} onAdd={vi.fn()} labels={{ title: '项目', add: '添加项目', empty: '暂无项目' }}/><SessionTabs sessions={[{ id: 'a', title: '方案' }]} activeId="a" onSelect={vi.fn()} onRename={vi.fn()} onAdd={vi.fn()} labels={{ title: '会话', add: '新会话', rename: { hint: '双击或 F2 重命名', input: name => `重命名 ${name}`, save: '保存', cancel: '取消', empty: '名称不能为空' } }}/><ToolExecutionCard title="检查" status="success" labels={{ details: '执行详情', statuses: { success: '已完成' } }}>详情</ToolExecutionCard><InspectorHeader title="检查器" count={1} onRefresh={vi.fn()} labels={{ refresh: '刷新检查' }}/><FileRow name="说明" detail="文件" onOpen={open} labels={{ open: '打开说明' }}/></UIProvider>);
  expect(screen.getByRole('navigation', { name: '项目' })).toBeTruthy(); expect(screen.getByText('暂无项目')).toBeTruthy(); expect(screen.getByRole('button', { name: '添加项目' })).toBeTruthy(); expect(screen.getByRole('button', { name: '新会话' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: '方案' }), { key: 'F2' }); expect(screen.getByRole('textbox', { name: '重命名 方案' })).toBeTruthy(); expect(screen.getByRole('button', { name: '保存' })).toBeTruthy(); expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  expect(screen.getByText('已完成')).toBeTruthy(); expect(screen.getByRole('button', { name: '检查 · 执行详情 · 已完成' })).toBeTruthy(); expect(screen.getByRole('button', { name: '刷新检查' })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '打开说明' })); expect(open).toHaveBeenCalledOnce();
});
it('ChatMessage keeps author semantics without repeated visual headings, and scopes string line breaks separately from React prose', () => {
  const view = render(<UIProvider><ChatMessage role="user" author="中文作者">{'第一行\nEnglish 2026'}</ChatMessage><ChatMessage role="assistant" author="小派" metadata="0.8s"><h1>回答章节</h1><p>普通正文</p><pre><code>{'const value = 1;\nreturn value;'}</code></pre></ChatMessage></UIProvider>);
  expect(screen.getByText('中文作者').closest('header')?.className).toBe('ui-visually-hidden');
  expect(screen.getByText('小派').closest('header')?.getAttribute('aria-hidden')).toBeNull();
  expect(view.container.querySelector('.ui-chat-message-user .ui-chat-body-text')?.textContent).toBe('第一行\nEnglish 2026');
  expect(view.container.querySelector('.ui-chat-message-assistant .ui-chat-body-text')).toBeNull();
  expect(screen.getByText('0.8s').closest('.ui-visually-hidden')).toBeNull();
  expect(screen.getByRole('heading', { name: '回答章节' }).closest('.ui-chat-body')).toBeTruthy();
});

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle']) globalThis[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; Base UI rejects mouse presses outside measured trigger bounds.
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 31, width: 100, height: 31, toJSON() {} });
const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { render, cleanup, screen, within, act, fireEvent, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { Sidebar, UIProvider, SessionRow, ProjectRow } = await import('@pua/components');
const h = React.createElement;
const user = () => userEvent.setup({ document });
const session = Object.freeze({ id: 's', title: 'Conversation', canPin: true, unread: true, primaryAction: { id: 'archive', label: 'Archive', kind: 'archive' } });
const project = Object.freeze({ id: 'p', title: 'Workspace', sessionIds: ['s'] });
const base = { projects: [project], sessions: [session], recentSessionIds: ['s'], expandedProjectIds: ['p'] };
const wrap = (child, theme = 'light') => h(UIProvider, { theme }, child);
const sidebar = props => wrap(h(Sidebar, { ...base, ...props }));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
afterEach(cleanup);

test('public package SSR is scoped, semantic, readonly and right-only without time/count badges', () => {
  const html = renderToStaticMarkup(wrap(h(SessionRow, { session: { ...session, presentation: { execution: { state: 'error' }, environment: { kind: 'remote' }, identity: { kind: 'aeon' } } }, onSelect() {} }), 'dark'));
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('[data-theme]').getAttribute('data-theme'), 'dark');
  const button = doc.querySelector('button');
  assert.equal(button.textContent, 'Conversation');
  assert.equal(button.querySelector('svg'), null);
  for (const label of ['Error', 'Unread', 'Remote host', 'Aeon identity']) {
    const indicator = doc.querySelector(`[aria-label="${label}"]`);
    assert.ok(indicator && !button.contains(indicator), label);
    assert.equal(indicator.parentElement.parentElement.previousElementSibling, button, label);
  }
  assert.equal(doc.querySelector('time'), null);
  assert.equal(doc.body.textContent.includes('99+'), false);
  assert.equal(session.unread, true);
});

test('controlled callbacks report explicit IDs/next values; data does not mutate', async () => {
  const events = [];
  render(sidebar({ onSelectSession: id => events.push(['select', id]), onPinSession: (id, next) => events.push(['pin', id, next]), onProjectExpandedChange: (id, next) => events.push(['expand', id, next]) }));
  const u = user();
  await u.click(screen.getAllByRole('button', { name: /^Conversation/ })[0]);
  await u.click(screen.getAllByRole('button', { name: '置顶 Conversation' })[0]);
  await u.click(screen.getByRole('button', { name: 'Workspace', exact: true }));
  assert.deepEqual(events, [['select', 's'], ['pin', 's', true], ['expand', 'p', false]]);
  assert.equal(screen.getByRole('button', { name: 'Workspace', exact: true }).getAttribute('aria-expanded'), 'true');
  assert.equal(session.pinned, undefined);
});

test('duplicate projections share a synchronous mutation lock; reject, retry and navigation lane', async () => {
  const job = deferred(); let calls = 0, selections = 0;
  render(sidebar({ onPinSession: () => { calls++; return calls === 1 ? job.promise : undefined; }, onSelectSession: () => { selections++; } }));
  const pins = screen.getAllByRole('button', { name: '置顶 Conversation' });
  act(() => { fireEvent.click(pins[0]); fireEvent.click(pins[1]); });
  assert.equal(calls, 1);
  await user().click(screen.getAllByRole('button', { name: /^Conversation/ })[1]);
  assert.equal(selections, 1);
  await act(async () => job.reject(new Error('retry me')));
  assert.equal(screen.getAllByRole('alert').length, 2);
  await user().click(pins[1]);
  assert.equal(calls, 2);
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(document.activeElement, pins[1]);
});

test('remove/readd keeps outstanding lock but stale rejection cannot affect new lifetime; unmount is safe', async () => {
  const job = deferred(); let calls = 0;
  const props = { onPinSession: () => { calls++; return job.promise; } };
  const view = render(sidebar(props));
  fireEvent.click(screen.getAllByRole('button', { name: '置顶 Conversation' })[0]);
  view.rerender(sidebar({ ...props, sessions: [] }));
  view.rerender(sidebar(props));
  fireEvent.click(screen.getAllByRole('button', { name: '置顶 Conversation' })[1]);
  assert.equal(calls, 1);
  await act(async () => job.reject(new Error('stale failure')));
  assert.equal(screen.queryByRole('alert'), null);
  fireEvent.click(screen.getAllByRole('button', { name: '置顶 Conversation' })[0]);
  await act(async () => {});
  assert.equal(calls, 2);
  view.unmount();
  const pending = deferred();
  render(sidebar({ onPinSession: () => pending.promise }));
  fireEvent.click(screen.getAllByRole('button', { name: '置顶 Conversation' })[0]);
  cleanup();
  await act(async () => pending.reject(new Error('after unmount')));
  assert.equal(screen.queryByRole('alert'), null);
});

test('More does not toggle project; recursive/disabled menus and Escape focus stay in the scoped portal', async () => {
  let expanded = 0; const actions = [];
  const menu = [{ type: 'action', id: 'blocked', label: 'Blocked', disabledReason: 'No access' }, { type: 'submenu', id: 'group', label: 'Organize', items: [{ type: 'action', id: 'nested', label: 'Move' }] }];
  render(wrap(h(ProjectRow, { project: { ...project, menu }, expanded: true, onExpandedChange: () => { expanded++; }, onAction: id => actions.push(id) }), 'dark'));
  const u = user(), trigger = screen.getByRole('button', { name: 'Workspace 更多操作' });
  await u.click(trigger);
  assert.equal(expanded, 0);
  const popup = await screen.findByRole('menu', { name: 'Workspace 更多操作' });
  assert.equal(popup.closest('[data-theme]').getAttribute('data-theme'), 'dark');
  const blocked = within(popup).getByRole('menuitem', { name: 'Blocked · No access' });
  assert.equal(blocked.getAttribute('aria-disabled'), 'true');
  await u.click(blocked);
  assert.deepEqual(actions, []);
  const submenu = within(popup).getByRole('menuitem', { name: 'Organize' });
  act(() => submenu.focus());
  await u.keyboard('{ArrowRight}');
  await waitFor(() => assert.ok(screen.getByRole('menuitem', { name: 'Move' })));
  await u.keyboard('{Escape}{Escape}');
  await waitFor(() => assert.equal(document.activeElement, trigger));
  assert.equal(expanded, 0);
  await u.click(trigger);
  await screen.findByRole('menu', { name: 'Workspace 更多操作' });
  act(() => screen.getByRole('menuitem', { name: 'Organize' }).focus());
  await u.keyboard('{ArrowRight}');
  await u.click(await screen.findByRole('menuitem', { name: 'Move' }));
  assert.deepEqual(actions, ['nested']);
});

test('scheduled Snooze is keyboard/mouse accessible; leaving focus clears status interaction', async () => {
  let snoozed = 0;
  render(wrap(h(SessionRow, { session: { ...session, presentation: { attention: { kind: 'input', style: 'pill', progress: .45 } } }, onSelect() {}, onPin() {}, onSnooze: () => { snoozed++; } })));
  const u = user(), snooze = screen.getByRole('button', { name: 'Snooze' });
  await u.click(snooze);
  await u.keyboard('{Enter}');
  assert.equal(snoozed, 2);
  await u.tab();
  assert.equal(document.activeElement, screen.getByRole('button', { name: '置顶 Conversation' }));
  assert.equal(snooze.closest('[data-status-interaction]'), null);
});

test('computed CSS keeps status/actions mutually exclusive across rest, title focus, Snooze and open menu', async () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../dist/styles.css', import.meta.url), 'utf8');
  document.head.append(style);
  try {
    render(wrap(h(SessionRow, { session: { ...session, menu: [{ type: 'action', id: 'manage', label: 'Manage' }], presentation: { attention: { kind: 'input', style: 'pill', progress: .45 } } }, onSelect() {}, onPin() {}, onSnooze() {}, onMenuAction() {} })));
    const label = screen.getByRole('button', { name: /^Conversation ·/ });
    const snooze = screen.getByRole('button', { name: 'Snooze' });
    const pin = screen.getByRole('button', { name: '置顶 Conversation' });
    const status = snooze.parentElement.parentElement.parentElement;
    const rail = pin.parentElement;
    const opacity = element => Number(getComputedStyle(element).opacity || 1);
    const expectRails = (state, actions) => { assert.equal(opacity(status), state); assert.equal(opacity(rail), actions); };
    assert.equal(getComputedStyle(label.parentElement).height, '31px');
    expectRails(1, 0);
    act(() => label.focus());
    expectRails(0, 1);
    act(() => snooze.focus());
    expectRails(1, 0);
    fireEvent.mouseLeave(label.parentElement);
    expectRails(1, 0); // Pointer exit must not hide a keyboard-focused Snooze.
    act(() => pin.focus());
    expectRails(0, 1);
    const trigger = screen.getByRole('button', { name: 'Conversation 更多操作' });
    act(() => trigger.focus());
    await user().keyboard('{Enter}');
    await screen.findByRole('menu', { name: 'Conversation 更多操作' });
    fireEvent.mouseMove(status);
    expectRails(0, 1); // Open menu takes precedence over status pointer targeting.
    await user().keyboard('{Escape}');
    await waitFor(() => assert.equal(document.activeElement, trigger));
  } finally { style.remove(); }
});

test('sibling providers keep light/dark menu portals local without mutating body theme', async () => {
  const menu = [{ type: 'action', id: 'edit', label: 'Edit' }];
  render(h(React.Fragment, {}, ...['light', 'dark'].map(theme => wrap(h(ProjectRow, { project: { id: theme, title: theme, menu }, expanded: false, onAction() {} }), theme))));
  for (const theme of ['light', 'dark']) {
    await user().click(screen.getByRole('button', { name: `${theme} 更多操作` }));
    const popup = await screen.findByRole('menu', { name: `${theme} 更多操作` });
    assert.equal(popup.closest('[data-theme]').getAttribute('data-theme'), theme);
    await user().keyboard('{Escape}');
  }
  assert.equal(document.body.getAttribute('data-theme'), null);
});

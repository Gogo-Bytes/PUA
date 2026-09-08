/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { media, mediaChange } from './component-preview/test-setup';
import { Breadcrumbs, Message, ToastHost, UIProvider } from '../src/renderer/ui';
import { gsap } from 'gsap';
afterEach(() => vi.useRealTimers());
it('Message communicates four tones with icon and text, optional actions/dismiss, and opt-in announcement', () => {
  const dismiss = vi.fn(), action = vi.fn();
  const view = render(<UIProvider>{(['info', 'success', 'warning', 'error'] as const).map(tone => <Message key={tone} tone={tone}>Content</Message>)}</UIProvider>);
  expect(screen.queryByRole('status')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  expect(view.container.querySelectorAll('.ui-message-icon[aria-hidden="true"]')).toHaveLength(4);
  for (const label of ['Information', 'Success', 'Warning', 'Error']) expect(screen.getByText(label)).toBeTruthy();
  view.rerender(<UIProvider><Message tone="error" announcement="assertive" toneLabel="错误" onDismiss={dismiss} dismissLabel="关闭通知" action={{ label: '重试', onClick: action }}>保留内容</Message></UIProvider>);
  expect(screen.getByRole('alert').textContent).toBe('错误保留内容');
  expect(screen.getByRole('alert').querySelector('svg path')).toBeTruthy();
  expect(screen.getByText('错误').className).toBe('ui-visually-hidden');
  fireEvent.click(screen.getByRole('button', { name: '重试' })); fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
  expect(action).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
});
it('ToastHost pauses remaining time for hover OR focus, resumes only after both leave, and uses latest callback', () => {
  vi.useFakeTimers(); const dismiss = vi.fn(), latest = vi.fn();
  const items = [{ id: 'a', children: 'Saved', duration: 1000, action: { label: 'Undo', onClick: vi.fn() } }];
  const view = render(<UIProvider motion="off"><ToastHost items={items} onDismiss={dismiss}/></UIProvider>);
  const toast = screen.getByText('Saved').closest('li')!;
  act(() => vi.advanceTimersByTime(400)); fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(2000)); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.focus(screen.getByRole('button', { name: 'Undo' })); fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(2000)); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByRole('button', { name: 'Undo' }), { relatedTarget: document.body });
  view.rerender(<UIProvider motion="off"><ToastHost items={items} onDismiss={latest}/></UIProvider>);
  act(() => vi.advanceTimersByTime(599)); expect(latest).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(latest).toHaveBeenCalledWith('a');
  act(() => vi.advanceTimersByTime(5000)); expect(latest).toHaveBeenCalledOnce();
});
it('ToastHost bounds visible stack, starts waiting timers on mount, preserves focus and clears timers/GSAP on unmount', () => {
  vi.useFakeTimers(); const dismiss = vi.fn();
  const items = [{ id: 'a', children: 'Persistent', duration: 0 }, { id: 'b', children: 'Waiting', duration: 1000 }];
  const tree = (data = items) => <UIProvider motion="slow"><button>Opener</button><ToastHost items={data} maxVisible={1} onDismiss={dismiss}/></UIProvider>;
  const view = render(tree([])); screen.getByRole('button', { name: 'Opener' }).focus(); view.rerender(tree());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opener' })); expect(screen.queryByText('Waiting')).toBeNull();
  act(() => vi.advanceTimersByTime(3000)); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' })); expect(dismiss).toHaveBeenCalledWith('a');
  view.rerender(tree(items.slice(1))); const toast = screen.getByText('Waiting').closest('li')!;
  expect(gsap.getTweensOf(toast).length).toBeGreaterThan(0);
  view.unmount(); expect(gsap.getTweensOf(toast)).toHaveLength(0);
  act(() => vi.advanceTimersByTime(5000)); expect(dismiss).toHaveBeenCalledOnce();
});
it('ToastHost reduced motion settles immediately and repeated mount/unmount releases context history', () => {
  const contexts = new Set<gsap.Context>(), original = gsap.context;
  vi.spyOn(gsap, 'context').mockImplementation((...args: Parameters<typeof original>) => { const context = original(...args); contexts.add(context); return context; });
  const tree = (show: boolean) => <UIProvider motion="slow">{show && <ToastHost items={[{ id: 'a', children: 'Toast', duration: 0 }]} onDismiss={vi.fn()}/>}</UIProvider>;
  const view = render(tree(true)); act(() => { media.matches = true; mediaChange(); });
  const toast = screen.getByText('Toast').closest('li')!;
  expect(Number(gsap.getProperty(toast, 'opacity'))).toBe(1); expect(Number(gsap.getProperty(toast, 'y'))).toBe(0);
  for (let i = 0; i < 40; i++) { view.rerender(tree(false)); expect([...contexts].reduce((sum, ctx) => sum + ctx.data.length, 0)).toBe(0); view.rerender(tree(true)); }
  view.unmount(); expect([...contexts].reduce((sum, ctx) => sum + ctx.data.length, 0)).toBe(0);
});
it('Breadcrumbs exposes nav/current page and callback or safe href; long labels remain complete without default paths', () => {
  const select = vi.fn(), long = '很长的名称'.repeat(50);
  render(<UIProvider><Breadcrumbs label="当前位置" items={[{ id: 'a', label: '工作台', onSelect: select }, { id: 'b', label: '文档', href: 'https://example.com/docs' }, { id: 'bad', label: 'Unsafe', href: 'javascript:alert(1)' }, { id: 'c', label: long, href: '/current' }]}/></UIProvider>);
  expect(screen.getByRole('navigation', { name: '当前位置' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '工作台' })); expect(select).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('…')); screen.getByText('…').closest('details')!.open = true;
  expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toBe('https://example.com/docs');
  expect(screen.queryByRole('link', { name: 'Unsafe' })).toBeNull(); expect(screen.getByText(long).getAttribute('aria-current')).toBe('page');
});
it('Breadcrumbs exposes complete truncated labels on keyboard focus and keeps all collapsed levels operable', () => {
  const select = vi.fn(), outerEscape = vi.fn(), long = '完整的会话标题'.repeat(12);
  render(<UIProvider><div onKeyDown={outerEscape}><Breadcrumbs items={[{ id: 'home', label: 'Home' }, { id: 'team', label: 'Team', onSelect: select }, { id: 'docs', label: 'Docs', href: '/docs' }, { id: 'current', label: long }]}/></div></UIProvider>);
  const current = screen.getByText(long); fireEvent.focus(current);
  expect(screen.getByRole('tooltip').textContent).toBe(long);
  fireEvent.keyDown(current, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  const summary = screen.getByText('…'), details = summary.closest('details')!; details.open = true;
  fireEvent.click(screen.getByRole('button', { name: 'Team' })); expect(select).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('/docs');
  fireEvent.keyDown(details, { key: 'Escape' }); expect(details.open).toBe(false); expect(document.activeElement).toBe(summary);
  expect(outerEscape).not.toHaveBeenCalled();
  fireEvent.keyDown(summary, { key: 'Escape' }); expect(outerEscape).toHaveBeenCalledOnce();
});
it.each(['data:text/html,hi', '//evil.test', '\\evil.test', 'java\nscript:alert(1)'])('Breadcrumbs rejects unsafe href %s', href => {
  render(<UIProvider><Breadcrumbs items={[{ id: 'a', label: 'Unsafe', href }, { id: 'b', label: 'Current' }]}/></UIProvider>);
  expect(screen.queryByRole('link')).toBeNull();
});

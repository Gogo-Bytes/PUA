/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setWidth } from './component-preview/test-setup';
import { ResizableWorkspace, UIProvider } from '../src/renderer/ui';
const setup = () => render(<UIProvider motion="off"><ResizableWorkspace left={<button>Left content</button>} right={<button>Right content</button>}><button>Center content</button></ResizableWorkspace></UIProvider>);
const handle = (side = 'left') => screen.getByRole('separator', { name: `Resize ${side} panel` });
const width = (side = 'left') => Number(handle(side).getAttribute('aria-valuenow'));
it('supports a wider review panel without weakening center/minimum constraints', () => {
  render(<UIProvider motion="off"><ResizableWorkspace rightSize={{ initial: 560, min: 280, max: 1000 }} left={<p>Left</p>} right={<p>Right</p>}>Center</ResizableWorkspace></UIProvider>);
  expect(width('right')).toBe(544);
  fireEvent.keyDown(handle('right'), { key: 'Home' }); expect(width('right')).toBe(280);
  fireEvent.keyDown(handle('right'), { key: 'End' }); expect(width() + width('right') + 16).toBe(840);
  act(() => setWidth(800)); expect(screen.queryByRole('separator', { name: 'Resize right panel' })).toBeNull();
});
describe('ResizableWorkspace interface', () => {
  it('captures pointers, updates synchronously, clamps both min/max, restores body styles on cancel', () => {
    setup(); const separator = handle(); document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text';
    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 280, button: 0 });
    expect(separator.setPointerCapture).toHaveBeenCalledWith(7); expect(document.body.style.cursor).toBe('col-resize');
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 290 }); expect(width()).toBe(290);
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 900 }); expect(width()).toBe(360);
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: -300 }); expect(width()).toBe(180);
    fireEvent.pointerCancel(separator, { pointerId: 7 }); expect(document.body.style.cursor).toBe('crosshair'); expect(document.body.style.userSelect).toBe('text');
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(7);
  });
  it('supports right pointer direction and cleans active capture on unmount', () => {
    const view = setup(); const separator = handle('right');
    fireEvent.pointerDown(separator, { pointerId: 2, clientX: 900, button: 0 });
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 856 }); expect(width('right')).toBe(344);
    view.unmount(); expect(document.body.style.cursor).not.toBe('col-resize'); expect(separator.releasePointerCapture).toHaveBeenCalledWith(2);
  });
  it('supports keyboard physical direction/Home/End and retains widths through complete hide/restore', () => {
    setup(); fireEvent.keyDown(handle(), { key: 'End' }); expect(width()).toBe(360);
    fireEvent.keyDown(handle(), { key: 'Home' }); expect(width()).toBe(180);
    fireEvent.keyDown(handle(), { key: 'ArrowRight' }); expect(width()).toBe(196);
    fireEvent.keyDown(handle('right'), { key: 'ArrowLeft' }); expect(width('right')).toBe(316);
    fireEvent.click(screen.getByRole('button', { name: 'Hide left panel' })); fireEvent.click(screen.getByRole('button', { name: 'Hide right panel' }));
    expect(screen.queryAllByRole('separator')).toHaveLength(0); expect(screen.queryByRole('button', { name: 'Left content' })).toBeNull();
    expect(screen.getByText('Left content').closest('aside')?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show left panel' })); fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }));
    expect(width()).toBe(196); expect(width('right')).toBe(316);
  });
  it('preserves the center minimum, auto-hides right then left and recovers saved preferences', () => {
    setup(); act(() => setWidth(800)); expect(width() + width('right') + 16).toBeLessThanOrEqual(800 - 360);
    fireEvent.keyDown(handle(), { key: 'End' }); expect(width()).toBe(Number(handle().getAttribute('aria-valuemax')));
    act(() => setWidth(700)); expect(screen.queryByRole('separator', { name: 'Resize right panel' })).toBeNull(); expect(handle()).toBeTruthy();
    act(() => setWidth(500)); expect(screen.queryAllByRole('separator')).toHaveLength(0);
    act(() => setWidth(1200)); expect(screen.getAllByRole('separator')).toHaveLength(2); expect(width('right')).toBe(300);
  });
  it('returns focus to a permanent toggle when a panel becomes unavailable', () => {
    setup(); screen.getByRole('button', { name: 'Right content' }).focus(); act(() => setWidth(700));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show right panel' }));
  });
});
it.each([['right', 700], ['left', 500]] as const)('returns focused %s separator to the permanent restore control before responsive hiding', (side, narrowWidth) => {
  setup(); handle(side).focus(); act(() => setWidth(narrowWidth));
  const restore = screen.getByRole('button', { name: `Show ${side} panel` });
  expect(document.activeElement).toBe(restore); expect(restore.getAttribute('aria-disabled')).toBe('true');
  expect(restore.getAttribute('title')).toMatch(/空间足够/);
});

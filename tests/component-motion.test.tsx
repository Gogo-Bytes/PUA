/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { media, mediaChange } from './component-preview/test-setup';
import { Collapsible, UIProvider, ResizableWorkspace, MotionSample } from '../src/renderer/ui';
import { gsap } from 'gsap';
// Real GSAP lifecycle assertions in jsdom; visual interpolation is separately verified in Chrome.
it('real GSAP rapid toggles end hidden/inert and unmount reverts all owned tweens', () => {
  const view = render(<UIProvider><Collapsible title="Details"><button>Inside</button></Collapsible></UIProvider>);
  const trigger = screen.getByRole('button', { name: 'Details' }); const content = screen.getByText('Inside').closest('.ui-reveal') as HTMLElement;
  for (let i = 0; i < 7; i++) fireEvent.click(trigger);
  expect(content.hasAttribute('inert')).toBe(false); expect(gsap.getTweensOf(content).length).toBeLessThanOrEqual(1);
  fireEvent.click(trigger); expect(content.hasAttribute('inert')).toBe(true);
  act(() => { gsap.globalTimeline.getChildren().forEach(animation => animation.totalProgress(1)); }); expect(content.hidden).toBe(true);
  fireEvent.click(trigger); view.unmount(); expect(gsap.getTweensOf(content)).toHaveLength(0);
});
it('off and live system reduced-motion settle immediately with no displacement', () => {
  const view = render(<UIProvider motion="slow"><Collapsible title="Details"><button>Inside</button></Collapsible></UIProvider>);
  const trigger = screen.getByRole('button', { name: 'Details' }); fireEvent.click(trigger);
  act(() => { media.matches = true; mediaChange(); });
  const content = screen.getByText('Inside').closest('.ui-reveal') as HTMLElement;
  expect(content.hidden).toBe(false); expect(gsap.getProperty(content.firstElementChild, 'y')).toBe(0);
  fireEvent.click(trigger); expect(content.hidden).toBe(true);
  view.rerender(<UIProvider motion="off"><Collapsible title="Details"><button>Inside</button></Collapsible></UIProvider>);
  fireEvent.click(trigger); expect(gsap.getProperty(content.firstElementChild, 'opacity')).toBe(1);
});
it('ResizableWorkspace rapid visibility changes overwrite owned tweens and unmount cleans both panel and grid', async () => {
  const { ResizableWorkspace } = await import('../src/renderer/ui');
  const view = render(<UIProvider><ResizableWorkspace motionControls left={<button>Left</button>} right={<button>Right</button>}>Center</ResizableWorkspace></UIProvider>);
  const panel = screen.getByText('Left').closest('aside')!, grid = view.container.querySelector('.ui-workspace-grid')!;
  for (let i = 0; i < 8; i++) fireEvent.click(screen.getByRole('button', { name: `${i % 2 ? 'Show' : 'Hide'} left panel` }));
  expect(panel.hasAttribute('inert')).toBe(false); expect(gsap.getTweensOf(panel).length).toBeLessThanOrEqual(1); expect(gsap.getTweensOf(grid).length).toBeLessThanOrEqual(1);
  view.unmount(); expect(gsap.getTweensOf(panel)).toHaveLength(0); expect(gsap.getTweensOf(grid)).toHaveLength(0);
});

it('GSAP contexts retain bounded objects through 160 drag updates and 80 structure/replay updates', () => {
  const contexts = new Set<gsap.Context>();
  const original = gsap.context;
  vi.spyOn(gsap, 'context').mockImplementation((...args: Parameters<typeof original>) => {
    const context = original(...args); contexts.add(context); return context;
  });
  const retained = () => [...contexts].reduce((total, context) => total + context.data.length, 0);
  const tree = (replay: number) => <UIProvider><ResizableWorkspace motionControls left={<button>Left</button>} right={<button>Right</button>}><Collapsible title="Bounded"><button>Inside bounded</button></Collapsible><MotionSample replay={replay}/></ResizableWorkspace></UIProvider>;
  const view = render(tree(0));
  const initial = retained();
  const separator = screen.getByRole('separator', { name: 'Resize left panel' });
  fireEvent.pointerDown(separator, { pointerId: 1, button: 0, clientX: 224 });
  for (let i = 0; i < 160; i++) fireEvent.pointerMove(separator, { pointerId: 1, clientX: 225 + i % 100 });
  fireEvent.pointerUp(separator, { pointerId: 1 });
  expect(retained(), 'immediate grid updates must not retain zero-duration tweens').toBeLessThanOrEqual(initial);
  let warm = 0;
  for (let i = 0; i < 80; i++) {
    fireEvent.click(screen.getByRole('button', { name: `${i % 2 ? 'Show' : 'Hide'} left panel` }));
    fireEvent.click(screen.getByRole('button', { name: 'Bounded' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay motion' }));
    view.rerender(tree(i + 1));
    if (i % 4 === 0) act(() => { gsap.globalTimeline.getChildren().forEach(animation => animation.totalProgress(1)); });
    if (i === 9) warm = retained();
    if (i > 9) expect(retained(), `retained objects at iteration ${i}`).toBeLessThanOrEqual(warm + 3);
  }
  view.unmount(); expect(retained()).toBe(0);
});
it('MotionSample rapid replay preserves its current position and does not reset its opacity', () => {
  const view = render(<UIProvider motion="slow"><MotionSample replay={0}/></UIProvider>);
  const sample = view.container.querySelector('.ui-motion-sample')!;
  act(() => { gsap.getTweensOf(sample).forEach(tween => tween.progress(0.4)); });
  const before = Number(gsap.getProperty(sample, 'opacity'));
  view.rerender(<UIProvider motion="slow"><MotionSample replay={1}/></UIProvider>);
  expect(Number(gsap.getProperty(sample, 'opacity'))).toBeCloseTo(before, 3);
});

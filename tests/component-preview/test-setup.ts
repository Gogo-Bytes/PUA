import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
export let resize: () => void;
export let measuredWidth = 1200;
export function setWidth(width: number) { measuredWidth = width; resize(); }
export let mediaChange: () => void;
export const media = { matches: false, media: '(prefers-reduced-motion: reduce)', addEventListener: (_: string, callback: () => void) => { mediaChange = callback; }, removeEventListener: vi.fn() };
beforeEach(() => {
  measuredWidth = 1200; media.matches = false;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: measuredWidth, height: 400, x: 0, y: 0, top: 0, left: 0, right: measuredWidth, bottom: 400, toJSON() {} }));
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

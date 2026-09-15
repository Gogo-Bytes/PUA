import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type Ref } from 'react';
import { Button, Icon } from './primitives';
import { gsap, useGSAP, motionTokens } from './motion';
import { useMotionScale } from './theme';
type Side = 'left' | 'right';
const MIN = 180, MAX = 360, CENTER_MIN = 360, HANDLE = 8;
const clamp = (value: number, max: number) => Math.max(MIN, Math.min(max, value));
/** Container-first fitting: right temporarily hides before left; saved preferences survive narrow viewports. */
export function ResizableWorkspace({ left, right, children, rightOpen, onRightOpenChange, toolbarActions, rightToggleRef, motionControls = false, hideToolbar = false, labels }: { left: ReactNode; right: ReactNode; children: ReactNode; rightOpen?: boolean; onRightOpenChange?(open: boolean): void; toolbarActions?: ReactNode; rightToggleRef?: Ref<HTMLButtonElement>; motionControls?: boolean; hideToolbar?: boolean; labels?: { left: string; right: string; show: string; hide: string; resize(side: 'left' | 'right'): string; compact: string; hint: string } }) {
  const text = labels ?? { left: 'left panel', right: 'right panel', show: 'Show', hide: 'Hide', resize: (side: Side) => `Resize ${side} panel`, compact: 'Compact · panels return when space permits', hint: 'Drag edges · arrows to resize' };
  const root = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null), leftRef = useRef<HTMLElement>(null), rightRef = useRef<HTMLElement>(null);
  const previousLayout = useRef<{ left: boolean; right: boolean; containerWidth: number } | null>(null);
  const separators = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  const [replayCount, setReplayCount] = useState(0);
  const previousReplay = useRef(0);
  const toggles = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({});
  const [containerWidth, setContainerWidth] = useState(1200), [widths, setWidths] = useState({ left: 224, right: 256 }), [localShown, setLocalShown] = useState({ left: true, right: true });
  const shown = { ...localShown, right: rightOpen ?? localShown.right };
  const toggle = (side: Side, value: boolean) => { setLocalShown(previous => ({ ...previous, [side]: value })); if (side === 'right') onRightOpenChange?.(value); };
  const drag = useRef<{ side: Side; x: number; width: number; target: HTMLElement; pointerId: number; cursor: string; select: string } | null>(null);
  const scale = useMotionScale();
  useLayoutEffect(() => {
    const node = root.current!;
    const measure = () => {
      const width = node.clientWidth || node.getBoundingClientRect().width;
      if (width <= 0) return;
      // Read focus before React removes the separator (or makes the aside inert).
      for (const side of ['left', 'right'] as const) {
        const minimum = CENTER_MIN + MIN + HANDLE + (side === 'right' && shown.left ? MIN + HANDLE : 0);
        const panel = side === 'left' ? leftRef.current : rightRef.current;
        if (width < minimum && (panel?.contains(document.activeElement) || separators.current[side] === document.activeElement)) toggles.current[side]?.focus();
      }
      setContainerWidth(width);
    };
    measure(); const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure); observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [shown.left]);
  const visible = { left: shown.left && containerWidth >= CENTER_MIN + MIN + HANDLE, right: shown.right && containerWidth >= CENTER_MIN + MIN + HANDLE + (shown.left ? MIN + HANDLE : 0) };
  const available = Math.max(0, containerWidth - CENTER_MIN - (visible.left ? HANDLE : 0) - (visible.right ? HANDLE : 0));
  const actual = { left: visible.left ? Math.min(widths.left, available - (visible.right ? MIN : 0)) : 0, right: 0 };
  actual.right = visible.right ? Math.min(widths.right, available - actual.left) : 0;
  const maxFor = (side: Side) => Math.min(MAX, available - actual[side === 'left' ? 'right' : 'left']);
  const canShow = (side: Side) => containerWidth >= CENTER_MIN + MIN + HANDLE + (side === 'right' && shown.left ? MIN + HANDLE : 0);
  function stopDrag() {
    const current = drag.current; if (!current) return; drag.current = null;
    if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    document.body.style.cursor = current.cursor; document.body.style.userSelect = current.select;
  }
  useEffect(() => () => stopDrag(), []);
  useEffect(() => { if (drag.current && !visible[drag.current.side]) stopDrag(); }, [visible.left, visible.right]);
  function startDrag(event: PointerEvent<HTMLDivElement>, side: Side) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { side, x: event.clientX, width: actual[side], target: event.currentTarget, pointerId: event.pointerId, cursor: document.body.style.cursor, select: document.body.style.userSelect };
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current || event.pointerId !== current.pointerId) return;
    const width = clamp(current.width + (event.clientX - current.x) * (current.side === 'left' ? 1 : -1), maxFor(current.side));
    setWidths(previous => ({ ...previous, [current.side]: width }));
  }
  // Layout interpolation is restricted to explicit toggles. Resize/pointer updates always set immediately.
  useGSAP(context => {
    // Drop history without reverting styles: reversals start at the interrupted position.
    context.kill(false);
    const columns = `${actual.left}px ${visible.left ? HANDLE : 0}px minmax(0, 1fr) ${visible.right ? HANDLE : 0}px ${actual.right}px`;
    const previous = previousLayout.current;
    const toggled = previous && previous.containerWidth === containerWidth && (previous.left !== visible.left || previous.right !== visible.right);
    if (toggled && scale) gsap.to(grid.current, { gridTemplateColumns: columns, duration: motionTokens.structure * scale, ease: motionTokens.ease, overwrite: true });
    else grid.current!.style.gridTemplateColumns = columns;
    previousLayout.current = { ...visible, containerWidth };
  }, { scope: root, dependencies: [actual.left, actual.right, visible.left, visible.right, containerWidth, scale] });
  useGSAP(context => {
    const interrupted = context.getTweens().flatMap((tween: gsap.core.Tween) => tween.progress() < 1 ? tween.targets() : []);
    context.kill(false);
    const replaying = previousReplay.current !== replayCount;
    previousReplay.current = replayCount;
    for (const side of ['left', 'right'] as const) {
      const node = side === 'left' ? leftRef.current! : rightRef.current!;
      if (replaying && visible[side] && !interrupted.includes(node) && scale) gsap.set(node, { x: -8, autoAlpha: 0 });
      gsap.to(node, { autoAlpha: visible[side] ? 1 : 0, x: visible[side] ? 0 : side === 'left' ? -12 : 12, duration: motionTokens.structure * scale, ease: motionTokens.ease, overwrite: true });
      if (!visible[side] && node.contains(document.activeElement)) toggles.current[side]?.focus();
    }
  }, { scope: root, dependencies: [visible.left, visible.right, scale, replayCount] });
  const separator = (side: Side) => <div ref={node => { separators.current[side] = node; }} className="ui-separator" role="separator" aria-label={text.resize(side)} aria-orientation="vertical" aria-valuemin={MIN} aria-valuemax={maxFor(side)} aria-valuenow={Math.round(actual[side])} tabIndex={0} onPointerDown={event => startDrag(event, side)} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={event => {
    const delta = side === 'left' ? 16 : -16;
    const next = event.key === 'Home' ? MIN : event.key === 'End' ? maxFor(side) : event.key === 'ArrowLeft' ? actual[side] - delta : event.key === 'ArrowRight' ? actual[side] + delta : null;
    if (next === null) return; event.preventDefault(); setWidths(previous => ({ ...previous, [side]: clamp(next, maxFor(side)) }));
  }}/>;
  return <div ref={root} className="ui-workspace" onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || !visible.right) return;
    const target = event.target as Element;
    if (target.closest('input, textarea, select, [contenteditable], dialog, [role="menu"]')) return;
    if (!rightRef.current?.contains(target) && target !== toggles.current.right) return;
    event.preventDefault(); toggles.current.right?.focus(); toggle('right', false);
  }}>
    {!hideToolbar && <div className="ui-workspace-toolbar">{(['left', 'right'] as const).map(side => <Button ref={node => { toggles.current[side] = node; if (side === 'right') { if (typeof rightToggleRef === 'function') rightToggleRef(node); else if (rightToggleRef) rightToggleRef.current = node; } }} key={side} variant="ghost" aria-expanded={visible[side]} aria-disabled={!visible[side] && !canShow(side) || undefined} title={!visible[side] ? 'Saved width returns when the container has enough room.' : undefined} onClick={() => { if (!visible[side] && !canShow(side)) return; stopDrag(); toggle(side, !visible[side]); }}><Icon name="panel"/>{visible[side] ? text.hide : text.show} {text[side]}</Button>)}{motionControls && <details className="ui-workspace-test-controls"><summary>测试控制 · 动效</summary><Button variant="ghost" onClick={() => setReplayCount(count => count + 1)}>Replay motion</Button></details>}{toolbarActions}<span className="ui-meta">{containerWidth < 736 ? text.compact : text.hint}</span></div>}
    <div ref={grid} className="ui-workspace-grid">
      <aside ref={leftRef} className="ui-workspace-side" inert={!visible.left} aria-hidden={!visible.left} style={{ overflow: visible.left ? undefined : 'hidden' }}>{left}</aside>
      {visible.left ? separator('left') : <div/>}<main className="ui-workspace-main">{children}</main>{visible.right ? separator('right') : <div/>}
      <aside ref={rightRef} className="ui-workspace-side ui-workspace-right" inert={!visible.right} aria-hidden={!visible.right} style={{ overflow: visible.right ? undefined : 'hidden' }}>{right}</aside>
    </div>
  </div>;
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type Ref, type RefObject } from 'react';
import { Button, Icon } from './primitives';
import { gsap, useGSAP, motionTokens } from './motion';
import { useMotionScale } from './theme';
type Side = 'left' | 'right';
const MIN = 180,
  MAX = 360,
  CENTER_MIN = 360,
  HANDLE = 8;
const clamp = (value: number, max: number, min = MIN) => Math.max(min, Math.min(max, value));
/** One fixed, non-resizable column between the main content and right panel.
 * The caller owns open intent; fitting never writes it back. Content receives
 * actual visibility so resource reads can pause while the column is inert.
 */
export interface WorkspaceAuxiliaryColumn {
  id: string;
  label: string;
  width: number;
  gap: number;
  open: boolean;
  toggleRef: RefObject<HTMLButtonElement | null>;
  onVisibilityChange(visible: boolean): void;
  content(visible: boolean): ReactNode;
}
/** Container fitting: auxiliary leaves first, then right and left; preferences survive. */
export interface ResizableWorkspaceProps {
  left: ReactNode;
  right: ReactNode;
  children: ReactNode;
  leftOpen?: boolean;
  onLeftOpenChange?(open: boolean): void;
  rightOpen?: boolean;
  onRightOpenChange?(open: boolean): void;
  toolbarActions?: ReactNode;
  leftToggleRef?: Ref<HTMLButtonElement>;
  rightToggleRef?: Ref<HTMLButtonElement>;
  motionControls?: boolean;
  hideToolbar?: boolean;
  auxiliary?: WorkspaceAuxiliaryColumn;
  rightSize?: { initial: number; min: number; max: number };
  labels?: {
    left: string;
    right: string;
    show: string;
    hide: string;
    resize(side: 'left' | 'right'): string;
    compact: string;
    hint: string;
  };
}

export function ResizableWorkspace({
  left,
  right,
  children,
  leftOpen,
  onLeftOpenChange,
  rightOpen,
  onRightOpenChange,
  toolbarActions,
  leftToggleRef,
  rightToggleRef,
  motionControls = false,
  hideToolbar = false,
  rightSize,
  auxiliary,
  labels,
}: ResizableWorkspaceProps) {
  const text = labels ?? {
    left: 'left panel',
    right: 'right panel',
    show: 'Show',
    hide: 'Hide',
    resize: (side: Side) => `Resize ${side} panel`,
    compact: 'Compact · panels return when space permits',
    hint: 'Drag edges · arrows to resize',
  };
  const rightMin = rightSize?.min ?? MIN;
  const rightMax = rightSize?.max ?? MAX;
  const root = useRef<HTMLDivElement>(null),
    grid = useRef<HTMLDivElement>(null),
    leftRef = useRef<HTMLElement>(null),
    rightRef = useRef<HTMLElement>(null),
    auxiliaryRef = useRef<HTMLDivElement>(null);
  const previousLayout = useRef<{ containerWidth: number; leftIntent: boolean; rightIntent: boolean; auxiliaryIntent: boolean } | null>(
    null,
  );
  const separators = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  const [replayCount, setReplayCount] = useState(0);
  const previousReplay = useRef(0);
  const toggles = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({});
  const [containerWidth, setContainerWidth] = useState(1200),
    [widths, setWidths] = useState({ left: 280, right: rightSize?.initial ?? 300 }),
    [localShown, setLocalShown] = useState({ left: true, right: true });
  const focusToggle = (side: Side) => {
    const external = side === 'left' ? leftToggleRef : rightToggleRef;
    (toggles.current[side] ?? (external && typeof external === 'object' ? external.current : null))?.focus();
  };
  const shown = { left: leftOpen ?? localShown.left, right: rightOpen ?? localShown.right };
  const toggle = (side: Side, value: boolean) => {
    setLocalShown(previous => ({ ...previous, [side]: value }));
    if (side === 'left') onLeftOpenChange?.(value);
    else onRightOpenChange?.(value);
  };
  const drag = useRef<{
    side: Side;
    x: number;
    width: number;
    target: HTMLElement;
    pointerId: number;
    cursor: string;
    select: string;
  } | null>(null);
  const scale = useMotionScale();
  // Auxiliary space is reserved only when preferred main widths fit. Once it
  // leaves, the original main-panel compression/hiding policy applies.
  const fit = (width: number, preferred = widths) => {
    const leftVisible = shown.left && width >= CENTER_MIN + MIN + HANDLE;
    const rightVisible = shown.right && width >= CENTER_MIN + rightMin + HANDLE + (shown.left ? MIN + HANDLE : 0);
    const auxiliaryVisible =
      !!auxiliary?.open &&
      leftVisible === shown.left &&
      rightVisible === shown.right &&
      width >=
        CENTER_MIN +
          (leftVisible ? preferred.left + HANDLE : 0) +
          (rightVisible ? preferred.right + HANDLE : 0) +
          auxiliary.width +
          auxiliary.gap;
    const auxiliarySpace = auxiliaryVisible ? auxiliary!.width + auxiliary!.gap : 0;
    const available = Math.max(0, width - CENTER_MIN - (leftVisible ? HANDLE : 0) - (rightVisible ? HANDLE : 0) - auxiliarySpace);
    const left = leftVisible ? Math.min(preferred.left, available - (rightVisible ? rightMin : 0)) : 0;
    const right = rightVisible ? Math.min(preferred.right, available - left) : 0;
    return { visible: { left: leftVisible, right: rightVisible, auxiliary: auxiliaryVisible }, actual: { left, right } };
  };
  const { visible, actual } = fit(containerWidth);
  const recoverFocus = (next: typeof visible) => {
    for (const side of ['left', 'right'] as const) {
      const panel = side === 'left' ? leftRef.current : rightRef.current;
      if (!next[side] && (panel?.contains(document.activeElement) || separators.current[side] === document.activeElement))
        focusToggle(side);
    }
    if (!next.auxiliary && auxiliaryRef.current?.contains(document.activeElement)) auxiliary?.toggleRef.current?.focus();
  };
  useLayoutEffect(() => {
    const node = root.current!;
    const measure = () => {
      const width = node.clientWidth || node.getBoundingClientRect().width;
      if (width <= 0) return;
      // Recover before React removes separators or marks a column inert.
      recoverFocus(fit(width).visible);
      setContainerWidth(width);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [shown.left, shown.right, rightMin, widths.left, widths.right, auxiliary?.open, auxiliary?.width, auxiliary?.gap]);
  useLayoutEffect(() => {
    recoverFocus(visible);
    auxiliary?.onVisibilityChange(visible.auxiliary);
  }, [visible.left, visible.right, visible.auxiliary, auxiliary?.onVisibilityChange]);
  // Drag/keyboard bounds exclude auxiliary space: growing a main panel evicts
  // the auxiliary column before constraining the user's preferred width.
  const available = Math.max(0, containerWidth - CENTER_MIN - (visible.left ? HANDLE : 0) - (visible.right ? HANDLE : 0));
  const maxFor = (side: Side) => Math.min(side === 'right' ? rightMax : MAX, available - actual[side === 'left' ? 'right' : 'left']);
  const canShow = (side: Side) =>
    containerWidth >= CENTER_MIN + (side === 'right' ? rightMin : MIN) + HANDLE + (side === 'right' && shown.left ? MIN + HANDLE : 0);
  const resize = (side: Side, width: number) => {
    const next = { ...widths, [side]: width };
    recoverFocus(fit(containerWidth, next).visible);
    setWidths(next);
  };
  function stopDrag() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.target.hasPointerCapture?.(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    document.body.style.cursor = current.cursor;
    document.body.style.userSelect = current.select;
  }
  useEffect(() => () => stopDrag(), []);
  useEffect(() => {
    if (drag.current && !visible[drag.current.side]) stopDrag();
  }, [visible.left, visible.right]);
  function startDrag(event: PointerEvent<HTMLDivElement>, side: Side) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      side,
      x: event.clientX,
      width: actual[side],
      target: event.currentTarget,
      pointerId: event.pointerId,
      cursor: document.body.style.cursor,
      select: document.body.style.userSelect,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const width = clamp(
      current.width + (event.clientX - current.x) * (current.side === 'left' ? 1 : -1),
      maxFor(current.side),
      current.side === 'right' ? rightMin : MIN,
    );
    resize(current.side, width);
  }
  // Layout interpolation is restricted to explicit toggles. Resize/pointer updates always set immediately.
  useGSAP(
    context => {
      // Drop history without reverting styles: reversals start at the interrupted position.
      context.kill(false);
      const auxiliaryColumns = auxiliary ? `${visible.auxiliary ? auxiliary.gap : 0}px ${visible.auxiliary ? auxiliary.width : 0}px ` : '';
      const columns = `${actual.left}px ${visible.left ? HANDLE : 0}px minmax(0, 1fr) ${auxiliaryColumns}${visible.right ? HANDLE : 0}px ${actual.right}px`;
      const previous = previousLayout.current;
      const toggled =
        previous &&
        previous.containerWidth === containerWidth &&
        (previous.leftIntent !== shown.left || previous.rightIntent !== shown.right || previous.auxiliaryIntent !== !!auxiliary?.open);
      if (toggled && scale)
        gsap.to(grid.current, {
          gridTemplateColumns: columns,
          duration: motionTokens.structure * scale,
          ease: motionTokens.ease,
          overwrite: true,
        });
      else grid.current!.style.gridTemplateColumns = columns;
      previousLayout.current = { containerWidth, leftIntent: shown.left, rightIntent: shown.right, auxiliaryIntent: !!auxiliary?.open };
    },
    {
      scope: root,
      dependencies: [
        actual.left,
        actual.right,
        visible.left,
        visible.right,
        visible.auxiliary,
        auxiliary?.width,
        auxiliary?.gap,
        shown.left,
        shown.right,
        auxiliary?.open,
        containerWidth,
        scale,
      ],
    },
  );
  useGSAP(
    context => {
      const interrupted = context.getTweens().flatMap((tween: gsap.core.Tween) => (tween.progress() < 1 ? tween.targets() : []));
      context.kill(false);
      const replaying = previousReplay.current !== replayCount;
      previousReplay.current = replayCount;
      if (auxiliaryRef.current) gsap.set(auxiliaryRef.current, { autoAlpha: visible.auxiliary ? 1 : 0 });
      for (const side of ['left', 'right'] as const) {
        const node = side === 'left' ? leftRef.current! : rightRef.current!;
        if (replaying && visible[side] && !interrupted.includes(node) && scale) gsap.set(node, { x: -8, autoAlpha: 0 });
        gsap.to(node, {
          autoAlpha: visible[side] ? 1 : 0,
          x: visible[side] ? 0 : side === 'left' ? -12 : 12,
          duration: motionTokens.structure * scale,
          ease: motionTokens.ease,
          overwrite: true,
        });
        if (!visible[side] && node.contains(document.activeElement)) focusToggle(side);
      }
    },
    { scope: root, dependencies: [visible.left, visible.right, visible.auxiliary, scale, replayCount] },
  );
  const separator = (side: Side) => (
    <div
      ref={node => {
        separators.current[side] = node;
      }}
      className="ui-separator"
      role="separator"
      aria-label={text.resize(side)}
      aria-orientation="vertical"
      aria-valuemin={side === 'right' ? rightMin : MIN}
      aria-valuemax={maxFor(side)}
      aria-valuenow={Math.round(actual[side])}
      tabIndex={0}
      onPointerDown={event => startDrag(event, side)}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onKeyDown={event => {
        const delta = side === 'left' ? 16 : -16;
        const next =
          event.key === 'Home'
            ? side === 'right'
              ? rightMin
              : MIN
            : event.key === 'End'
              ? maxFor(side)
              : event.key === 'ArrowLeft'
                ? actual[side] - delta
                : event.key === 'ArrowRight'
                  ? actual[side] + delta
                  : null;
        if (next === null) return;
        event.preventDefault();
        resize(side, clamp(next, maxFor(side), side === 'right' ? rightMin : MIN));
      }}
    />
  );
  return (
    <div
      ref={root}
      className="ui-workspace"
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || !visible.right)
          return;
        const target = event.target as Element;
        if (target.closest('input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="menu"], [role="listbox"]')) return;
        if (
          !rightRef.current?.contains(target) &&
          target !== toggles.current.right &&
          target !== (rightToggleRef && 'current' in rightToggleRef ? rightToggleRef.current : null)
        )
          return;
        event.preventDefault();
        (toggles.current.right ?? (rightToggleRef && 'current' in rightToggleRef ? rightToggleRef.current : null))?.focus();
        toggle('right', false);
      }}
    >
      {!hideToolbar && (
        <div className="ui-workspace-toolbar">
          {(['left', 'right'] as const).map(side => (
            <Button
              ref={node => {
                toggles.current[side] = node;
                const target = side === 'left' ? leftToggleRef : rightToggleRef;
                if (typeof target === 'function') target(node);
                else if (target) target.current = node;
              }}
              key={side}
              variant="ghost"
              aria-expanded={visible[side]}
              aria-disabled={(!visible[side] && !canShow(side)) || undefined}
              title={!visible[side] ? '空间足够时自动恢复面板' : undefined}
              onClick={() => {
                if (!visible[side] && !canShow(side)) return;
                stopDrag();
                toggle(side, !visible[side]);
              }}
            >
              <Icon name="panel" />
              {visible[side] ? text.hide : text.show} {text[side]}
            </Button>
          ))}
          {motionControls && (
            <details className="ui-workspace-test-controls">
              <summary>测试控制 · 动效</summary>
              <Button variant="ghost" onClick={() => setReplayCount(count => count + 1)}>
                Replay motion
              </Button>
            </details>
          )}
          {toolbarActions}
          <span className="ui-meta">{containerWidth < 736 ? text.compact : text.hint}</span>
        </div>
      )}
      <div ref={grid} className="ui-workspace-grid">
        <aside
          ref={leftRef}
          className="ui-workspace-side"
          inert={!visible.left}
          aria-hidden={!visible.left}
          style={{ overflow: visible.left ? undefined : 'hidden' }}
        >
          {left}
        </aside>
        {visible.left ? separator('left') : <div />}
        <main className="ui-workspace-main">{children}</main>
        {auxiliary && (
          <>
            <div aria-hidden="true" />
            <div
              ref={auxiliaryRef}
              id={auxiliary?.id}
              className="ui-workspace-auxiliary"
              inert={!visible.auxiliary}
              aria-hidden={!visible.auxiliary}
              aria-label={auxiliary?.label}
            >
              {auxiliary.content(visible.auxiliary)}
            </div>
          </>
        )}
        {visible.right ? separator('right') : <div />}
        <aside
          ref={rightRef}
          className="ui-workspace-side ui-workspace-right"
          inert={!visible.right}
          aria-hidden={!visible.right}
          style={{ overflow: visible.right ? undefined : 'hidden' }}
        >
          {right}
        </aside>
      </div>
    </div>
  );
}

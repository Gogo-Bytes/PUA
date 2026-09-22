import { cloneElement, forwardRef, useEffect, useLayoutEffect, useId, useRef, useState, type ReactElement, type ComponentPropsWithRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { Icon } from './Icon';
import { Reveal } from './motion';
export { Icon };
export const Button = forwardRef<HTMLButtonElement, ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }>(function Button({ variant = 'secondary', busy = false, className = '', children, disabled, ...props }, ref) {
  return <button ref={ref} type="button" {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`ui-button ui-button-${variant} ${className}`}>{busy && <Icon name="running"/>}{children}</button>;
});
export const IconButton = forwardRef<HTMLButtonElement, Omit<Parameters<typeof Button>[0], 'children'> & { label: string; icon: Parameters<typeof Icon>[0]['name'] }>(function IconButton({ label, icon, ...props }, ref) {
  return <Button ref={ref} {...props} className={`ui-icon-button ${props.className ?? ''}`} aria-label={label}><Icon name={icon}/></Button>;
});
export function TextField({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const id = useId();
  return <label className="ui-field"><span>{label}</span><input {...props} id={props.id ?? id} className="ui-input" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : props['aria-describedby']}/>{error && <span id={`${id}-error`} role="alert" className="ui-error">{error}</span>}</label>;
}
export function Tag({ children }: { children: ReactNode }) { return <span className="ui-tag">{children}</span>; }
export type RunStatus = 'idle' | 'running' | 'success' | 'error' | 'paused';
const statusLabels: Record<RunStatus, string> = { idle: 'Idle', running: 'Running', success: 'Complete', error: 'Failed', paused: 'Paused' };
export function StatusBadge({ status, label }: { status: RunStatus; label?: string }) {
  return <span className={`ui-status ui-status-${status}`}><Icon name={status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'paused' ? 'pause' : status === 'running' ? 'running' : 'clock'}/>{label ?? statusLabels[status]}</span>;
}
export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId(), anchor = useRef<HTMLSpanElement>(null), bubble = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const cancelLeave = () => { clearTimeout(leaveTimer.current); leaveTimer.current = undefined; };
  useEffect(() => () => cancelLeave(), []);
  useLayoutEffect(() => {
    if (!open) return;
    const node = bubble.current!, root = anchor.current!;
    // Native top layer escapes overflow/transform ancestors while retaining provider tokens
    // and DOM ownership (including a containing modal dialog). jsdom has no popover API.
    node.showPopover?.();
    let frame = 0;
    const fit = () => {
      frame = 0;
      const scrollTop = node.scrollTop;
      node.removeAttribute('data-scrollable');
      const rect = root.firstElementChild!.getBoundingClientRect();
      const style = getComputedStyle(node);
      const margin = parseFloat(style.getPropertyValue('--ui-space-2')) || 8;
      const gap = parseFloat(style.getPropertyValue('--ui-space-tight')) || 6;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      node.style.maxWidth = `${Math.max(1, Math.min(parseFloat(style.getPropertyValue('--ui-detail-width')) || 340, width - margin * 2))}px`;
      node.style.maxHeight = `${Math.max(1, height - margin * 2)}px`;
      const naturalHeight = node.scrollHeight + node.offsetHeight - node.clientHeight;
      const above = Math.max(0, rect.top - top - margin - gap);
      const below = Math.max(0, top + height - margin - rect.bottom - gap);
      const up = above >= naturalHeight || above >= below;
      const available = Math.max(above, below) < 24 ? height - margin * 2 : up ? above : below;
      node.style.maxHeight = `${Math.max(1, Math.min(available, height - margin * 2))}px`;
      const size = node.getBoundingClientRect();
      node.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - margin - size.width))}px`;
      node.style.top = `${Math.max(top + margin, Math.min(up ? rect.top - gap - size.height : rect.bottom + gap, top + height - margin - size.height))}px`;
      // Exceptionally long labels are a keyboard-scrollable reading region, not truncated.
      const scrollable = node.scrollHeight > node.clientHeight;
      node.tabIndex = scrollable ? 0 : -1;
      if (scrollable) node.setAttribute('data-scrollable', '');
      node.scrollTop = scrollTop;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !node.contains(event.target)) schedule(); };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    for (let element: Element | null = root; element; element = element.parentElement) observer?.observe(element);
    observer?.observe(node);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      node.hidePopover?.();
    };
  }, [open, content]);
  return <span ref={anchor} className="ui-tooltip-anchor"
    onMouseEnter={() => { cancelLeave(); setHovered(true); setDismissed(false); }}
    onMouseLeave={() => { cancelLeave(); leaveTimer.current = setTimeout(() => setHovered(false), 120); }}
    onFocus={() => { setFocused(true); setDismissed(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation(); event.preventDefault();
        if (bubble.current?.contains(document.activeElement)) (anchor.current?.firstElementChild as HTMLElement)?.focus();
        cancelLeave(); setHovered(false); setDismissed(true);
      }
    }}>{cloneElement(children, { 'aria-describedby': open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })}{open && <span ref={bubble} popover="manual" id={id} role="tooltip" className="ui-tooltip" tabIndex={-1}>{content}</span>}</span>;
}
export { Select, DropdownMenu, Tabs, type Choice } from './ChoiceControls';
export function Collapsible({ title, children, defaultOpen = false, label, open: controlledOpen, onOpenChange }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; label?: string; open?: boolean; onOpenChange?(open: boolean): void }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  return <CollapsiblePrimitive.Root render={<section/>} className="ui-collapsible" open={open} onOpenChange={setOpen}>
    <CollapsiblePrimitive.Trigger render={<Button variant="ghost"/>} aria-label={label}><Icon name={open ? 'down' : 'chevron'}/>{title}</CollapsiblePrimitive.Trigger>
    <CollapsiblePrimitive.Panel keepMounted><Reveal open={open}>{children}</Reveal></CollapsiblePrimitive.Panel>
  </CollapsiblePrimitive.Root>;
}
export { Dialog } from './shadcn-dialog';

import { cloneElement, useEffect, useLayoutEffect, useId, useRef, useState, type ReactElement, type ComponentPropsWithRef, type InputHTMLAttributes, type ReactNode, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { Reveal, gsap, useGSAP, motionTokens } from './motion';
import { useMotionScale } from './theme';
export { Icon };
export function Button({ variant = 'secondary', busy = false, className = '', children, disabled, ...props }: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button type="button" {...props} disabled={disabled || busy} aria-busy={busy || undefined} className={`ui-button ui-button-${variant} ${className}`}>{busy && <Icon name="running"/>}{children}</button>;
}
export function IconButton({ label, icon, ...props }: Omit<Parameters<typeof Button>[0], 'children'> & { label: string; icon: Parameters<typeof Icon>[0]['name'] }) {
  return <Button {...props} className={`ui-icon-button ${props.className ?? ''}`} aria-label={label}><Icon name={icon}/></Button>;
}
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
export type Choice = { value: string; label: string; disabled?: boolean };
/** Shared list behaviour for action menus and single-select choices. Tab leaves naturally; Escape returns focus. */
function ChoicePopup({ label, choices, value, onChoose, kind, disabled }: { label: string; choices: Choice[]; value?: string; onChoose(value: string): void; kind: 'menu' | 'listbox'; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false); const id = useId(); const scale = useMotionScale();
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const node = popup.current; if (!node) return;
      node.style.left = '0px';
      const rect = node.getBoundingClientRect();
      node.style.left = `${Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.right))}px`;
    };
    fit();
    const buttons = popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    (Array.from(buttons ?? []).find(b => b.dataset.value === value) ?? buttons?.[0])?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', fit);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', fit); };
  }, [open]);
  useGSAP(() => {
    if (open) gsap.fromTo(popup.current, { y: scale ? -4 : 0, opacity: scale ? 0 : 1 }, { y: 0, opacity: 1, duration: motionTokens.overlay * scale, ease: motionTokens.ease, overwrite: 'auto' });
  }, { scope: root, dependencies: [open, scale], revertOnUpdate: true });
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      next = -1;
      for (let step = 1; step <= items.length; step++) {
        const candidate = (index + step) % items.length;
        if (items[candidate].textContent?.toLowerCase().startsWith(event.key.toLowerCase())) { next = candidate; break; }
      }
    }
    else return;
    event.preventDefault(); items[next]?.focus();
  }
  return <div ref={root} className="ui-popup-anchor" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(false); }}>
    <Button ref={trigger} disabled={disabled || !choices.some(choice => !choice.disabled)} aria-label={label} aria-haspopup={kind} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}>{kind === 'listbox' ? choices.find(choice => choice.value === value)?.label ?? label : label}<Icon name="down"/></Button>
    {open && <div ref={popup} id={id} role={kind} aria-label={label} className="ui-popup" onKeyDown={keyDown}>{choices.map(choice => <button type="button" key={choice.value} role={kind === 'menu' ? 'menuitem' : 'option'} aria-selected={kind === 'listbox' ? value === choice.value : undefined} data-value={choice.value} tabIndex={-1} disabled={choice.disabled} onClick={() => { onChoose(choice.value); close(); }}>{choice.label}{value === choice.value && <Icon name="check"/>}</button>)}</div>}
  </div>;
}
export function Select({ label, options, value, onChange, disabled }: { label: string; options: Choice[]; value: string; onChange(value: string): void; disabled?: boolean }) {
  return <ChoicePopup kind="listbox" label={label} choices={options} value={value} onChoose={onChange} disabled={disabled}/>;
}
export function DropdownMenu({ label, items, onAction }: { label: string; items: Choice[]; onAction(value: string): void }) {
  return <ChoicePopup kind="menu" label={label} choices={items} onChoose={onAction}/>;
}
export function Tabs({ label, items, value, onChange }: { label: string; items: Choice[]; value: string; onChange(value: string): void }) {
  return <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={event => {
    const enabled = items.filter(item => !item.disabled), index = enabled.findIndex(item => item.value === value);
    const next = event.key === 'ArrowRight' ? (index + 1) % enabled.length : event.key === 'ArrowLeft' ? (index - 1 + enabled.length) % enabled.length : event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : -1;
    if (next < 0) return; event.preventDefault(); onChange(enabled[next].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[next]?.focus();
  }}>{items.map(item => <Button role="tab" key={item.value} variant="ghost" aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} disabled={item.disabled} onClick={() => onChange(item.value)}>{item.label}</Button>)}</div>;
}
export function Collapsible({ title, children, defaultOpen = false, label }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(defaultOpen); const id = useId();
  return <section className="ui-collapsible"><Button variant="ghost" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Icon name={open ? 'down' : 'chevron'}/>{title}</Button><div id={id}><Reveal open={open}>{children}</Reveal></div></section>;
}
export function Dialog({ open, title, onClose, children, closeLabel = 'Close dialog' }: { open: boolean; title: string; onClose(): void; children: ReactNode; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId(); const scale = useMotionScale();
  useEffect(() => {
    const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); if (open) previous?.focus(); };
  }, [open]);
  useGSAP(() => {
    if (open) gsap.fromTo(ref.current, { y: scale ? 8 : 0, opacity: scale ? 0 : 1 }, { y: 0, opacity: 1, duration: motionTokens.overlay * scale, ease: motionTokens.ease, overwrite: 'auto' });
  }, { scope: ref, dependencies: [open, scale], revertOnUpdate: true });
  return <dialog ref={ref} className="ui-dialog" aria-labelledby={id} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(node => !node.closest('[inert], [hidden]'));
    const first = items[0], last = items[items.length - 1];
    if (!first) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}><div className="ui-dialog-header"><h2 id={id}>{title}</h2><IconButton label={closeLabel} icon="close" variant="ghost" onClick={onClose}/></div>{children}</dialog>;
}

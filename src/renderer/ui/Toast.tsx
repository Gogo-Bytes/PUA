import { useEffect, useRef, useState } from 'react';
import { Message, type MessageProps } from './Message';
import { gsap, useGSAP, motionTokens } from './motion';
import { useMotionScale } from './theme';
export interface ToastItem extends Omit<MessageProps, 'onDismiss'> {
  /** Stable unique notification identity. Use a new id for a new lifetime. */
  id: string;
  /** Milliseconds; 0 persists. Defaults to 5000. Visible time only; hover/focus pauses. */
  duration?: number;
}
export interface ToastHostProps {
  items: readonly ToastItem[];
  onDismiss(id: string): void;
  /** Oldest first, at most this many mounted; waiting items start timers when visible. */
  maxVisible?: number;
  label?: string;
}
function Toast({ item, onDismiss }: { item: ToastItem; onDismiss(id: string): void }) {
  const root = useRef<HTMLLIElement>(null), dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const duration = item.duration ?? 5000;
  const remaining = useRef(duration), expired = useRef(false);
  const scale = useMotionScale();
  useEffect(() => { remaining.current = duration; expired.current = false; }, [duration]);
  useEffect(() => {
    if (duration <= 0 || hovered || focused || expired.current) return;
    const start = Date.now();
    const timer = setTimeout(() => { expired.current = true; dismiss.current(item.id); }, Math.max(0, remaining.current));
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - start)); };
  }, [duration, hovered, focused, item.id]);
  useGSAP(() => {
    gsap.fromTo(root.current, { y: scale ? 8 : 0, opacity: scale ? 0 : 1 }, { y: 0, opacity: 1, duration: motionTokens.overlay * scale, ease: motionTokens.ease });
  }, { scope: root, dependencies: [scale], revertOnUpdate: true });
  return <li ref={root} className="ui-toast" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}>
    <Message {...item} announcement={item.announcement ?? 'polite'} onDismiss={() => dismiss.current(item.id)}/>
  </li>;
}
/** Controlled, provider-scoped host. Caller removes dismissed ids; never moves focus or touches a global singleton. */
export function ToastHost({ items, onDismiss, maxVisible = 3, label = 'Notifications' }: ToastHostProps) {
  const limit = Number.isFinite(maxVisible) ? Math.max(1, Math.floor(maxVisible)) : 3;
  return <ol className="ui-toast-host" aria-label={label}>{items.slice(0, limit).map(item => <Toast key={item.id} item={item} onDismiss={onDismiss}/>)}</ol>;
}

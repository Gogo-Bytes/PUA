import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { Button } from './primitives';
export interface InlineRenameLabels { hint: string; input(value: string): string; save: string; cancel: string; empty: string; failed: string }
const defaults: InlineRenameLabels = { hint: 'Double-click or F2 to rename', input: value => `Rename ${value}`, save: 'Save', cancel: 'Cancel', empty: 'Name cannot be empty.', failed: 'Rename failed. Try again.' };
/** Blur keeps the draft. Async failures remain editable; only a successful commit exits editing. */
export function InlineRename({ value, onRename, onSelect, selected, selectionRole = 'tab', current = false, ref, labels }: { ref?: Ref<HTMLDivElement>; value: string; onRename(value: string): void | Promise<void>; onSelect?(): void; selected?: boolean; selectionRole?: 'tab' | 'button'; current?: boolean; labels?: Partial<InlineRenameLabels> }) {
  const text = { ...defaults, ...labels };
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const display = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null), composing = useRef(false), mounted = useRef(true), pending = useRef(false);
  const id = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  function start() { if (editing) return; setDraft(value); setError(''); setEditing(true); }
  function finish() { setEditing(false); setError(''); requestAnimationFrame(() => { if (mounted.current) display.current?.focus(); }); }
  async function commit() {
    if (pending.current || composing.current) return;
    const next = draft.trim();
    if (!next) { setError(text.empty); input.current?.focus(); return; }
    pending.current = true; setBusy(true); setError('');
    try { await onRename(next); if (mounted.current) finish(); }
    catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : text.failed); requestAnimationFrame(() => input.current?.focus()); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <div ref={ref} className="ui-rename" onDoubleClick={event => event.stopPropagation()}>
    {!editing ? <span ref={display} role={onSelect ? selectionRole : 'button'} aria-selected={onSelect && selectionRole === 'tab' ? selected : undefined} aria-current={current ? 'page' : undefined} tabIndex={onSelect && selectionRole === 'tab' ? selected ? 0 : -1 : 0} className="ui-rename-display" title={text.hint} onClick={onSelect} onDoubleClick={start} onKeyDown={event => {
      if (event.key === 'F2') { event.preventDefault(); start(); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(); }
    }}>{value}</span> : <div className="ui-rename-editor" tabIndex={-1} aria-busy={busy} onKeyDown={event => event.stopPropagation()}>
      <input ref={input} className="ui-input" aria-label={text.input(value)} value={draft} disabled={busy} aria-invalid={!!error} aria-describedby={error ? id : undefined} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
        event.stopPropagation();
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') { event.preventDefault(); void commit(); }
        if (event.key === 'Escape' && !pending.current) { event.preventDefault(); finish(); }
      }}/>
      <Button variant="ghost" busy={busy} onClick={() => void commit()}>{text.save}</Button><Button variant="ghost" disabled={busy} onClick={finish}>{text.cancel}</Button>
      {error && <span id={id} role="alert" className="ui-error">{error}</span>}
    </div>}
  </div>;
}

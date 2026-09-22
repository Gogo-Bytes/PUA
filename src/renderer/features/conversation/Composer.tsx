import { Textarea } from '../../ui';
import { useLayoutEffect, useRef, useState, type KeyboardEventHandler, type ReactNode, type Ref } from 'react';
import { Button, Icon, IconButton, Message } from '../../ui';
export interface ComposerAttachment { id: string; name: string; detail?: ReactNode }
export interface ComposerSubmission { conversationKey: string; value: string; attachments: readonly ComposerAttachment[] }
export interface ComposerLabels {
  message: string; placeholder: string; hint: string; send: string; queue: string; stop: string;
  addAttachments: string; attachments: string; removeAttachment(name: string): string;
  queued(count: number): string; failed: string; error: string;
}
const defaults: ComposerLabels = {
  message: 'Message', placeholder: 'Describe what you’d like to explore…', hint: 'Enter to send · Shift+Enter for a new line',
  send: 'Send', queue: 'Queue', stop: 'Stop', addAttachments: 'Add attachments', attachments: 'Attachments',
  removeAttachment: name => `Remove ${name}`, queued: count => `${count} queued`, failed: 'Could not complete the action.', error: 'Action failed',
};
export interface ComposerProps {
  /** Change on session switch; internally keys the pending/error lifetime, including A→B→A. */
  conversationKey: string;
  value: string;
  onValueChange(value: string): void;
  attachments: readonly ComposerAttachment[];
  onAddAttachments?(): void;
  onRemoveAttachment?(id: string): void;
  onSend?(submission: ComposerSubmission): void | Promise<void>;
  onQueue?(submission: ComposerSubmission): void | Promise<void>;
  editorRef?: Ref<HTMLTextAreaElement>;
  onEditorKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onFollowUp?(submission: ComposerSubmission): void | Promise<void>;
  onStop?(): void | Promise<void>;
  /** A running model still permits editing, attachments, queue and stop. */
  busy?: boolean;
  disabled?: boolean;
  queuedCount?: number;
  labels?: Partial<ComposerLabels>;
  /** Controls rendered in the composer footer before the attachment action. */
  footerControls?: ReactNode;
}
/** The caller owns data and snapshot clearing. Both preview and production use this editor. */
export function Composer(props: ComposerProps) {
  return <ComposerDraft key={props.conversationKey} {...props}/>;
}
function ComposerDraft({ conversationKey, value, onValueChange, attachments, onAddAttachments, onRemoveAttachment, onSend, onQueue, onStop, onFollowUp, editorRef, onEditorKeyDown, busy = false, disabled = false, queuedCount = 0, labels, footerControls }: ComposerProps) {
  const editor = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => { const node = editor.current; if (node) { node.style.height = '0px'; node.style.height = `${Math.min(160, Math.max(48, node.scrollHeight))}px`; } }, [value]);
  const text = { ...defaults, ...labels };
  const [pending, setPending] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), stopLocked = useRef(false), composing = useRef(false), mounted = useRef(false), revision = useRef(0);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // An external draft/attachment replacement invalidates errors from the previous snapshot, not the operation lock.
  useLayoutEffect(() => { revision.current++; setError(''); }, [value, attachments]);
  const submit = busy ? onQueue : onSend;
  const hasContent = !!value.trim() || attachments.length > 0;
  async function run(kind: 'submit' | 'stop' | 'followUp') {
    const callback = kind === 'stop' ? onStop : kind === 'followUp' ? onFollowUp : submit;
    const lock = kind === 'stop' ? stopLocked : locked;
    if (disabled || lock.current || !callback || (kind !== 'stop' && !hasContent) || (kind === 'stop' && !busy)) return;
    lock.current = true;
    const setBusy = kind === 'stop' ? setStopping : setPending;
    const version = revision.current;
    setBusy(true); setError('');
    try {
      if (kind === 'stop') await onStop!();
      else await (kind === 'followUp' ? onFollowUp! : submit!)({ conversationKey, value, attachments: attachments.map(item => ({ ...item })) });
    } catch (reason) {
      if (mounted.current && revision.current === version) setError(reason instanceof Error ? reason.message : text.failed);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="ui-composer" onSubmit={event => { event.preventDefault(); if (!composing.current) void run('submit'); }}>
    <Textarea ref={node => { editor.current = node; if (typeof editorRef === 'function') editorRef(node); else if (editorRef) editorRef.current = node; }} className="ui-input" aria-label={text.message} placeholder={text.placeholder} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      onEditorKeyDown?.(event);
      if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); void run(event.altKey && busy && onFollowUp ? 'followUp' : 'submit');
    }}/>
    {attachments.length > 0 && <ul className="ui-composer-attachments" aria-label={text.attachments}>{attachments.map(item => <li key={item.id}><Icon name="file"/><span>{item.name}{item.detail && <small>{item.detail}</small>}</span>{onRemoveAttachment && <IconButton icon="close" label={text.removeAttachment(item.name)} variant="ghost" disabled={disabled} onClick={() => onRemoveAttachment(item.id)}/>}</li>)}</ul>}
    <div className="ui-composer-footer"><div className="ui-composer-controls">
      {onAddAttachments && <IconButton icon="plus" variant="ghost" label={text.addAttachments} disabled={disabled} onClick={onAddAttachments}/>}
      {footerControls}
      <span className="ui-meta">{text.hint}</span>
      {queuedCount > 0 && <span className="ui-meta">{text.queued(queuedCount)}</span>}
      {busy && onStop && <Button disabled={disabled} busy={stopping} onClick={() => void run('stop')}><Icon name="stop"/>{text.stop}</Button>}
      {submit && <Button className="ui-composer-submit" type="submit" variant="primary" aria-label={busy ? text.queue : text.send} title={busy ? text.queue : text.send} busy={pending} disabled={disabled || !hasContent}><Icon name="up"/></Button>}
    </div></div>
    {error && <Message tone="error" toneLabel={text.error} announcement="assertive">{error}</Message>}
  </form>;
}

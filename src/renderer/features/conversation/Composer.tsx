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
  onStop?(): void | Promise<void>;
  /** A running model still permits editing, attachments, queue and stop. */
  busy?: boolean;
  disabled?: boolean;
  queuedCount?: number;
  labels?: Partial<ComposerLabels>;
}
export interface TranscriptComposerProps {
  variant: 'transcript';
  attachmentList?: ReactNode;
  editorRef?: Ref<HTMLTextAreaElement>;
  editorLabel: string;
  placeholder: string;
  value: string;
  disabled?: boolean;
  onCompositionChange(composing: boolean): void;
  onValueChange(value: string): void;
  onEditorKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  actions: ReactNode;
}
/** The caller owns data and successful-send clearing policy. This component never clears a draft or attachment. */
export function Composer(props: ComposerProps | TranscriptComposerProps) {
  if ('variant' in props) return <div className="composer">
    {props.attachmentList}
    <textarea disabled={props.disabled} ref={props.editorRef} aria-label={props.editorLabel} placeholder={props.placeholder} value={props.value}
      onCompositionStart={() => props.onCompositionChange(true)} onCompositionEnd={() => props.onCompositionChange(false)}
      onChange={event => props.onValueChange(event.target.value)} onKeyDown={props.onEditorKeyDown} />
    <div className="composer-actions">{props.actions}</div>
  </div>;
  return <ComposerDraft key={props.conversationKey} {...props}/>;
}
function ComposerDraft({ conversationKey, value, onValueChange, attachments, onAddAttachments, onRemoveAttachment, onSend, onQueue, onStop, busy = false, disabled = false, queuedCount = 0, labels }: ComposerProps) {
  const text = { ...defaults, ...labels };
  const [pending, setPending] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), stopLocked = useRef(false), composing = useRef(false), mounted = useRef(false), revision = useRef(0);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // An external draft/attachment replacement invalidates errors from the previous snapshot, not the operation lock.
  useLayoutEffect(() => { revision.current++; setError(''); }, [value, attachments]);
  const submit = busy ? onQueue : onSend;
  const hasContent = !!value.trim() || attachments.length > 0;
  async function run(kind: 'submit' | 'stop') {
    const callback = kind === 'stop' ? onStop : submit;
    const lock = kind === 'stop' ? stopLocked : locked;
    if (disabled || lock.current || !callback || (kind === 'submit' && !hasContent) || (kind === 'stop' && !busy)) return;
    lock.current = true;
    const setBusy = kind === 'stop' ? setStopping : setPending;
    const version = revision.current;
    setBusy(true); setError('');
    try {
      if (kind === 'stop') await onStop!();
      else await submit!({ conversationKey, value, attachments: attachments.map(item => ({ ...item })) });
    } catch (reason) {
      if (mounted.current && revision.current === version) setError(reason instanceof Error ? reason.message : text.failed);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <form className="ui-composer" onSubmit={event => { event.preventDefault(); if (!composing.current) void run('submit'); }}>
    <textarea className="ui-input" aria-label={text.message} placeholder={text.placeholder} value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault(); void run('submit');
    }}/>
    {attachments.length > 0 && <ul className="ui-composer-attachments" aria-label={text.attachments}>{attachments.map(item => <li key={item.id}><Icon name="file"/><span>{item.name}{item.detail && <small>{item.detail}</small>}</span>{onRemoveAttachment && <IconButton icon="close" label={text.removeAttachment(item.name)} variant="ghost" disabled={disabled} onClick={() => onRemoveAttachment(item.id)}/>}</li>)}</ul>}
    <div className="ui-composer-footer"><div className="ui-composer-controls">
      {onAddAttachments && <IconButton icon="plus" variant="ghost" label={text.addAttachments} disabled={disabled} onClick={onAddAttachments}/>}
      <span className="ui-meta">{text.hint}</span>
      {queuedCount > 0 && <span className="ui-meta">{text.queued(queuedCount)}</span>}
      {busy && onStop && <Button disabled={disabled} busy={stopping} onClick={() => void run('stop')}><Icon name="stop"/>{text.stop}</Button>}
      {submit && <Button className="ui-composer-submit" type="submit" variant="primary" aria-label={busy ? text.queue : text.send} title={busy ? text.queue : text.send} busy={pending} disabled={disabled || !hasContent}><Icon name="up"/></Button>}
    </div></div>
    {error && <Message tone="error" toneLabel={text.error} announcement="assertive">{error}</Message>}
  </form>;
}

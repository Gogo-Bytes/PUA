import type { ReactNode } from 'react';
import { Button, IconButton } from './primitives';
export type MessageTone = 'info' | 'success' | 'warning' | 'error';
export type MessageAction = { label: string; onClick(): void; disabled?: boolean };
export interface MessageProps {
  tone?: MessageTone;
  children: ReactNode;
  /** Static inline content is silent. Use polite for updates, assertive only for urgent failures. */
  announcement?: 'off' | 'polite' | 'assertive';
  toneLabel?: string;
  action?: MessageAction;
  onDismiss?(): void;
  dismissLabel?: string;
}
const tones = {
  info: { label: 'Information', path: 'M12 8h.01M12 11v6', round: true },
  success: { label: 'Success', path: 'm7 12 3 3 7-7', round: true },
  warning: { label: 'Warning', path: 'M12 3 2 21h20ZM12 9v5M12 17h.01', round: false },
  error: { label: 'Error', path: 'm9 9 6 6m0-6-6 6', round: true },
} as const;
/** Notification content, not a conversation message; actions are outside the live region. */
export function Message({ tone = 'info', children, announcement = 'off', toneLabel, action, onDismiss, dismissLabel = 'Dismiss message' }: MessageProps) {
  return <div className={`ui-message ui-message-${tone}`}>
    <div className="ui-message-content" role={announcement === 'assertive' ? 'alert' : announcement === 'polite' ? 'status' : undefined}>
      <svg className="icon ui-message-icon" viewBox="0 0 24 24" aria-hidden="true">{tones[tone].round && <circle cx="12" cy="12" r="9"/>}<path d={tones[tone].path}/></svg>
      <div className="ui-message-body"><span className="ui-visually-hidden">{toneLabel ?? tones[tone].label}</span>{children}</div>
    </div>
    {(action || onDismiss) && <div className="ui-message-actions">{action && <Button variant="ghost" disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>}{onDismiss && <IconButton icon="close" label={dismissLabel} variant="ghost" onClick={onDismiss}/>}</div>}
  </div>;
}

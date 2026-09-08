import type { ReactNode } from 'react';
import { Button, IconButton } from './primitives';
import { Icon } from './Icon';
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
  info: { label: 'Information' },
  success: { label: 'Success' },
  warning: { label: 'Warning' },
  error: { label: 'Error' },
} as const;
/** Notification content, not a conversation message; actions are outside the live region. */
export function Message({ tone = 'info', children, announcement = 'off', toneLabel, action, onDismiss, dismissLabel = 'Dismiss message' }: MessageProps) {
  return <div className={`ui-message ui-message-${tone}`}>
    <div className="ui-message-content" role={announcement === 'assertive' ? 'alert' : announcement === 'polite' ? 'status' : undefined}>
      <Icon className="ui-message-icon" name={tone}/>
      <div className="ui-message-body"><span className="ui-visually-hidden">{toneLabel ?? tones[tone].label}</span>{children}</div>
    </div>
    {(action || onDismiss) && <div className="ui-message-actions">{action && <Button variant="ghost" disabled={action.disabled} onClick={action.onClick}>{action.label}</Button>}{onDismiss && <IconButton icon="close" label={dismissLabel} variant="ghost" onClick={onDismiss}/>}</div>}
  </div>;
}

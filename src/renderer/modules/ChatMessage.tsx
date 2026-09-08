import type { ReactNode } from 'react';
import { Message } from '../ui';
export type ChatRole = 'user' | 'assistant' | 'system';
export interface ChatMessageProps {
  role: ChatRole;
  author: ReactNode;
  metadata?: ReactNode;
  /** React content only. Strings remain text; callers may supply a vetted renderer as a slot. */
  children: ReactNode;
  streaming?: boolean;
  error?: ReactNode;
  actions?: ReactNode;
  labels?: Partial<{ user: string; assistant: string; system: string; streaming: string; failed: string }>;
}
/** Conversation presentation only. No live region on streaming text and no desktop/clipboard/link effects. */
export function ChatMessage({ role, author, metadata, children, streaming = false, error, actions, labels }: ChatMessageProps) {
  const text = { user: 'User', assistant: 'Assistant', system: 'System', streaming: 'Responding…', failed: 'Response failed', ...labels };
  return <article className={`ui-chat-message ui-chat-message-${role}`} aria-label={text[role]}>
    <header className="ui-visually-hidden"><span>{author}</span><span> · {text[role]}</span></header>
    {metadata && <div className="ui-meta">{metadata}</div>}
    <div className={`ui-chat-body${typeof children === 'string' ? ' ui-chat-body-text' : ''}`} aria-busy={streaming || undefined}>{children}</div>
    {streaming && <span className="ui-meta">{text.streaming}</span>}
    {error && <Message tone="error" toneLabel={text.failed}>{error}</Message>}
    {actions && <footer>{actions}</footer>}
  </article>;
}

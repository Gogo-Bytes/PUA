import type { ReactNode } from 'react';
import { Message } from '../../ui';

export type ChatRole = 'user' | 'assistant' | 'system' | 'custom' | 'summary';
export interface ChatMessageLabels { user: string; assistant: string; system: string; custom: string; summary: string; streaming: string; failed: string }
export interface ChatMessageProps {
  role: ChatRole;
  author: ReactNode;
  metadata?: ReactNode;
  /** React content only. Strings remain text; callers may supply a vetted renderer as a slot. */
  children: ReactNode;
  streaming?: boolean;
  error?: ReactNode;
  actions?: ReactNode;
  labels?: Partial<ChatMessageLabels>;
}

/** Conversation presentation only. Desktop clipboard/link effects remain explicit caller slots. */
export function ChatMessage({ role, author, metadata, children, streaming = false, error, actions, labels }: ChatMessageProps) {
  const text = { user: 'User', assistant: 'Assistant', system: 'System', custom: 'Event', summary: 'Summary', streaming: 'Responding…', failed: 'Response failed', ...labels };
  return <article className={`ui-chat-message ui-chat-message-${role}`} aria-label={text[role]}>
    <header className="ui-visually-hidden"><span>{author}</span><span> · {text[role]}</span></header>
    {metadata && <div className="ui-meta">{metadata}</div>}
    <div className={`ui-chat-body${typeof children === 'string' ? ' ui-chat-body-text' : ''}`} aria-busy={streaming || undefined}>{children}</div>
    {streaming && <span className="ui-meta">{text.streaming}</span>}
    {error && <Message tone="error" toneLabel={text.failed}>{error}</Message>}
    {actions && <footer>{actions}</footer>}
  </article>;
}

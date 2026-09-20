import { useCallback, useRef, useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import type { ChatAttachment } from '../../../shared/ipc/conversation';
import type { TerminalHandle } from '../terminal';
import { referencePaths } from './reference-paths';
import { desktopClient } from '../../app/desktop-client';

interface SessionInputOptions {
  active: SessionInfo | undefined;
  activeId: string | null;
  dismissAfterInsert(): void;
  reportError(message: string): void;
  afterReference(): void;
}

/** Window input presentation: text by ID and live handles, not Chat revisions or xterm lifetime. */
export function useSessionInput({ active, activeId, dismissAfterInsert, reportError, afterReference }: SessionInputOptions) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({});
  const [initialSends, setInitialSends] = useState<Record<string, string>>({});
  const [initialAttachments, setInitialAttachments] = useState<Record<string, ChatAttachment[]>>({});
  const handles = useRef(new Map<string, TerminalHandle>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [found, setFound] = useState(true);
  const readDraft = (id: string) => drafts[id] || '';
  const replaceDraft = (id: string, text: string) => setDrafts(current => ({ ...current, [id]: text }));
  const readProjectDraft = (cwd: string) => projectDrafts[cwd] || '';
  const replaceProjectDraft = (cwd: string, text: string) => setProjectDrafts(current => ({ ...current, [cwd]: text }));
  const beginProjectSession = (cwd: string, id: string, text: string, attachments: ChatAttachment[] = []) => {
    setDrafts(current => ({ ...current, [id]: text }));
    setInitialSends(current => ({ ...current, [id]: text }));
    setInitialAttachments(current => ({ ...current, [id]: attachments }));
    setProjectDrafts(current => { const next = { ...current }; delete next[cwd]; return next; });
  };
  const readInitialSend = (id: string) => initialSends[id];
  const readInitialAttachments = (id: string) => initialAttachments[id] ?? [];
  const clearInitialSend = (id: string) => {
    setInitialSends(current => { const next = { ...current }; delete next[id]; return next; });
    setInitialAttachments(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const forgetDraft = (id: string) => {
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
    clearInitialSend(id);
  };
  const seedDraft = (id: string, text: string) => setDrafts(current => ({ ...current, [id]: text }));
  const stageProjectAttachments = async (cwd: string, id: string, text: string, paths: string[], onError: (message: string) => void): Promise<void> => {
    try {
      const attachments = paths.length ? await desktopClient.chooseChatAttachments(id, paths) : [];
      beginProjectSession(cwd, id, text, attachments);
    } catch (error) {
      seedDraft(id, text);
      onError(String(error));
      throw error;
    }
  };
  const onTerminalReady = (id: string, handle: TerminalHandle | null) => { if (handle) handles.current.set(id, handle); else handles.current.delete(id); };
  const handle = () => activeId ? handles.current.get(activeId) : undefined;
  const draft = activeId ? readDraft(activeId) : '';
  const setDraft = (text: string) => { if (activeId) replaceDraft(activeId, text); };
  // Render snapshot append is intentional; async attachment completion retains this target ID,
  // but resolves its still-live handle from the registry at completion (never a disposed object).
  const insertCommand = (text: string) => {
    if (active?.kind === 'chat') setDraft(draft ? `${draft}\n${text}` : text);
    else handle()?.paste(text);
    dismissAfterInsert(); // Only normal synchronous return dismisses; throw must retain query/open.
  };
  const chooseTerminalReferences = async () => {
    try { const paths = await desktopClient.chooseAttachments(); if (paths.length) insertCommand(referencePaths(paths)); }
    catch (error) { reportError(String(error)); }
  };
  const reference = (text: string) => {
    if (active?.kind === 'terminal') insertCommand(text);
    else {
      setDraft(draft ? `${draft}\n${text}` : text);
      document.querySelector<HTMLTextAreaElement>('.chat-pane.active textarea')?.focus();
    }
    afterReference();
  };
  // Only setter-based actions are stable: capture shortcuts intentionally depend on platform/kind.
  const toggleSearch = useCallback(() => setSearchOpen(value => !value), []);
  const hideSearch = useCallback(() => setSearchOpen(false), []);
  return {
    readDraft, replaceDraft, readProjectDraft, replaceProjectDraft, beginProjectSession, stageProjectAttachments, readInitialSend, readInitialAttachments, clearInitialSend, forgetDraft, seedDraft, onTerminalReady, insertCommand, chooseTerminalReferences, reference,
    searchOpen, searchText, found, toggleSearch, hideSearch,
    editSearch: (text: string) => { setSearchText(text); setFound(true); },
    find: (backwards?: boolean) => setFound(handle()?.search(searchText, backwards) ?? false),
    closeSearch: () => { handle()?.clearSearch(); setSearchOpen(false); handle()?.focus(); },
  };
}

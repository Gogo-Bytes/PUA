import { useState } from 'react';
import type { SessionInfo } from '../../../shared/contracts';
import { desktopClient } from '../../app/desktop-client';

/** Session label/dialog presentation, not host Session lifecycle or Pi persistence policy. */
export function useSessionPresentation(active: SessionInfo | undefined, setSessionTitle: (id: string, title: string) => void, reportError: (message: string) => void) {
  const [renaming, setRenaming] = useState(false);
  const saveRename = async (title: string) => {
    if (!active) return;
    // Capture the submitting render's active, not opening-time or await-completion selection.
    if (active.kind === 'chat') await desktopClient.renameChatSession(active.id, title);
    setSessionTitle(active.id, title); setRenaming(false);
  };
  return {
    renaming, beginRename: () => setRenaming(true), closeRename: () => setRenaming(false), saveRename,
    openProject: (id: string) => { void desktopClient.openProject(id).catch(error => reportError(String(error))); },
  };
}

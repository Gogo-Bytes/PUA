import { useWorkspace, useSessionInput } from '../features/workspace';
import { useSessionLaunchController, useSessionPresentation } from '../features/sessions';
import { useCommandPalette } from '../features/command-palette';
import { desktopClient, isDesktopAvailable } from './desktop-client';
import { useDesktopPresentation } from './useDesktopPresentation';

/** Connect real owners only: no mirrored state, effects or ref-registration bridge. */
export function useWorkspaceComposition(afterReference: () => void) {
  const desktopPresentation = useDesktopPresentation();
  const workspace = useWorkspace(isDesktopAvailable() ? desktopClient : undefined, {
    // useWorkspace calls this only after awaited close, never during this render.
    onClosed: id => input.forgetDraft(id),
    onError: desktopPresentation.reportError,
  });
  const palette = useCommandPalette(workspace.active);
  const input = useSessionInput({ active: workspace.active, activeId: workspace.activeId, dismissAfterInsert: palette.dismissAfterInsert, reportError: desktopPresentation.reportError, afterReference });
  const launch = useSessionLaunchController({
    boot: desktopPresentation.boot, project: workspace.project,
    onCreated: workspace.addCreatedSession,
    afterCreated: () => { input.hideSearch(); desktopPresentation.refresh(); },
    onSettings: desktopPresentation.showSettings,
    onPrepare: workspace.prepareConversation,
    onError: desktopPresentation.reportError,
  });
  const sessionActions = useSessionPresentation(workspace.active, workspace.setSessionTitle, desktopPresentation.reportError, cloned => {
    workspace.addCreatedSession(cloned);
    workspace.selectSession(cloned.id);
    input.hideSearch();
  });
  const navigation = {
    renameSession: (id: string, title: string) => {
      const session = workspace.sessions.find(item => item.id === id);
      if (session) return sessionActions.renameSession(session, title);
    },
    selectSession: (id: string) => { workspace.selectSession(id); input.hideSearch(); },
    selectProject: (cwd: string) => { workspace.prepareConversation(cwd); input.hideSearch(); },
    startProjectConversation: (cwd: string, text: string, trust: import('../../shared/ipc/conversation').ProjectTrust, attachmentPaths: string[] = []) => {
      return launch.createChatAnd(cwd, trust, session => input.stageProjectAttachments(cwd, session.id, text, attachmentPaths, desktopPresentation.reportError));
    },
  };
  return { desktopPresentation, workspace, palette, input, launch, sessionActions, navigation };
}

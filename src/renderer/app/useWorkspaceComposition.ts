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
  });
  const sessionActions = useSessionPresentation(workspace.active, workspace.setSessionTitle, desktopPresentation.reportError);
  const navigation = {
    selectSession: (id: string) => { workspace.selectSession(id); input.hideSearch(); },
    selectProject: (cwd: string) => { workspace.selectProject(cwd); input.hideSearch(); },
  };
  return { desktopPresentation, workspace, palette, input, launch, sessionActions, navigation };
}

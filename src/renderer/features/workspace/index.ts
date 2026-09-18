export { useWorkspace } from './useWorkspace';
export { projectName, groupProjects, selectSession, selectProject, prepareConversation, addSession, removeSession } from './selection';
export type { WorkspaceSession, SessionWorkspace } from './selection';
export { useSessionInput } from './useSessionInput';
export { ProjectNav, ProjectNavigation, type ProjectNavItem, type ProjectNavLabels, type ProjectNavProps } from './ProjectNav';
export { ProjectSidebar } from './ProjectSidebar';
export { readWorkspaceView, writeWorkspaceView, type WorkspaceViewPersistence } from './workspace-view-persistence';
export { SessionTabs, type WorkspaceSessionTab, type SessionTabsLabels, type SessionTabsProps } from './SessionTabs';
export { referencePaths } from './reference-paths';

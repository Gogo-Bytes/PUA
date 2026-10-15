/** Semantic UI state only. Callers resolve runtime, feature and business gates before rendering. */
export interface SessionPresentation {
  readonly execution?: { readonly state: 'working' | 'error'; readonly label?: string };
  readonly attention?: { readonly kind: 'approval' | 'input'; readonly style?: 'chip' | 'pill'; readonly progress?: number };
  readonly environment?: { readonly kind: 'remote' | 'remote-worktree' | 'worktree' | 'cloud'; readonly label?: string; readonly starting?: boolean };
  readonly identity?: {
    readonly kind?: 'aeon' | 'environment-setup';
    readonly automation?: 'run' | 'attached';
    readonly voice?: boolean;
    readonly liveVoice?: boolean;
    readonly events?: boolean;
    readonly teamMembers?: readonly string[];
  };
  /** An application-defined informational dot; not a backend status classifier. */
  readonly notice?: { readonly label: string; readonly tone?: 'info' | 'danger' | 'green' | 'purple' | 'yellow' | 'orange' };
}

export type SidebarId = string;
export type SidebarCallback = () => void | Promise<void>;
export type MenuIcon = 'pin' | 'edit' | 'folder' | 'reveal' | 'terminal' | 'read' | 'archive' | 'trash' | 'plus' | 'connection';

/** Caller-defined operations. IDs carry intent; labels are presentation only. */
export type SidebarMenuItem =
  | { readonly type: 'action'; readonly id: string; readonly label: string; readonly icon?: MenuIcon; readonly disabled?: boolean; readonly disabledReason?: string; readonly danger?: boolean; readonly checked?: boolean }
  | { readonly type: 'separator'; readonly id: string }
  | { readonly type: 'submenu'; readonly id: string; readonly label: string; readonly icon?: MenuIcon; readonly disabled?: boolean; readonly disabledReason?: string; readonly items: readonly SidebarMenuItem[] };


export interface SidebarProject {
  readonly id: SidebarId;
  readonly title: string;
  readonly sessionIds: readonly SidebarId[];
  readonly pinned?: boolean;
  readonly menu?: readonly SidebarMenuItem[];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface SidebarSession {
  readonly id: SidebarId;
  readonly title: string;
  readonly pinned?: boolean;
  readonly unread?: boolean;
  readonly canPin?: boolean;
  readonly summary?: string;
  readonly presentation?: SessionPresentation;
  /** Caller may offer a management menu on a disabled row. Global disabled still wins. */
  readonly allowMenuWhenDisabled?: boolean;
  /** Optional More menu appears before Pin; omit if this capability is absent. */
  readonly menu?: readonly SidebarMenuItem[];
  /** By default a More menu replaces the quick Archive button. */
  readonly retainArchiveAction?: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly primaryAction?: { readonly id: string; readonly label: string; readonly kind: 'archive' | 'close'; readonly disabled?: boolean; readonly disabledReason?: string };
}

export interface SidebarLabels {
  navigation: string;
  projects: string;
  recent: string;
  newSession: string;
  search: string;
  commands: string;
  settings: string;
  emptyProjects: string;
  emptySessions: string;
  loading: string;
}

export interface SidebarProps {
  readonly projects: readonly SidebarProject[];
  readonly sessions: readonly SidebarSession[];
  readonly recentSessionIds: readonly SidebarId[];
  readonly expandedProjectIds: readonly SidebarId[];
  readonly selectedProjectId?: SidebarId | null;
  readonly selectedSessionId?: SidebarId | null;
  readonly labels?: Partial<SidebarLabels>;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly onProjectExpandedChange?: (projectId: SidebarId, expanded: boolean) => void | Promise<void>;
  readonly onSelectProject?: (projectId: SidebarId) => void | Promise<void>;
  readonly onSelectSession?: (sessionId: SidebarId) => void | Promise<void>;
  readonly onNewSession?: (projectId: SidebarId | null) => void | Promise<void>;
  readonly onProjectAction?: (projectId: SidebarId, actionId: string) => void | Promise<void>;
  readonly onPinSession?: (sessionId: SidebarId, nextPinned: boolean) => void | Promise<void>;
  readonly onSnoozeSession?: (sessionId: SidebarId) => void | Promise<void>;
  readonly onSessionMenuAction?: (sessionId: SidebarId, actionId: string) => void | Promise<void>;
  readonly onSessionPrimaryAction?: (sessionId: SidebarId, actionId: string) => void | Promise<void>;
  readonly onSearch?: SidebarCallback;
  readonly onCommands?: SidebarCallback;
  readonly onSettings?: SidebarCallback;
}

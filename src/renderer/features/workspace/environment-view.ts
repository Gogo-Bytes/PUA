/** Presentation values only: the card never receives a host client or mutable Session owner. */
export interface EnvironmentCardView {
  sessionAvailable: boolean;
  taskBusy: boolean;
  cwd?: string;
  status?: { branch: string; fileCount: number };
  statusError?: string;
  branches?: { current: string; names: readonly string[] };
  worktrees?: readonly { path: string; branch?: string; current: boolean }[];
  backgroundProcesses: readonly { id: string; title: string; activityLabel: string }[];
  showBranches: boolean;
  showWorktrees: boolean;
  newBranch: string;
  newWorktreeBranch: string;
  busy?: 'branch' | 'worktree' | 'commit';
  branchError?: string;
  worktreeError?: string;
}

export type EnvironmentConfirmation =
  | { kind: 'delete-branch'; sessionId: string; target: string }
  | { kind: 'delete-worktree'; sessionId: string; target: string }
  | { kind: 'commit'; sessionId: string; fileCount: number; message: string };

export interface EnvironmentGitView {
  confirmation?: EnvironmentConfirmation;
  busy: boolean;
  error?: string;
}

export type EnvironmentIntent =
  | { type: 'close' }
  | { type: 'open-panel'; kind: 'review' | 'task' }
  | { type: 'select-session'; id: string }
  | { type: 'toggle-branches' }
  | { type: 'toggle-worktrees' }
  | { type: 'edit-branch'; value: string }
  | { type: 'edit-worktree'; value: string }
  | { type: 'switch-branch'; branch: string }
  | { type: 'create-branch' }
  | { type: 'create-worktree' }
  | { type: 'delete-branch'; branch: string }
  | { type: 'delete-worktree'; path: string }
  | { type: 'open-commit' }
  | { type: 'retry-read' };

export type EnvironmentGitIntent =
  | { type: 'cancel' }
  | { type: 'edit-message'; value: string }
  | { type: 'confirm-delete' }
  | { type: 'commit'; push: boolean }
  | { type: 'push' };

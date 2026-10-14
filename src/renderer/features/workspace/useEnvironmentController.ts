import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import type { GitBranches, GitStatus, GitWorktrees } from '../../../shared/ipc/change-review';
import { desktopClient } from '../../app/desktop-client';
import type {
  EnvironmentCardView,
  EnvironmentConfirmation,
  EnvironmentGitIntent,
  EnvironmentGitView,
  EnvironmentIntent,
} from './environment-view';

interface EnvironmentScope {
  sessionId?: string;
  active: boolean;
  readEpoch: number;
}
interface EnvironmentState {
  scope: EnvironmentScope;
  status?: GitStatus;
  statusError?: string;
  branches?: GitBranches;
  worktrees?: GitWorktrees;
  branchError?: string;
  worktreeError?: string;
  commitError?: string;
  showBranches: boolean;
  showWorktrees: boolean;
  newBranch: string;
  newWorktreeBranch: string;
  confirmation?: EnvironmentConfirmation;
}
const emptyState = (scope: EnvironmentScope): EnvironmentState => ({
  scope,
  showBranches: false,
  showWorktrees: false,
  newBranch: '',
  newWorktreeBranch: '',
});

/** Owns visible snapshots and Git continuations; host Session/path/idle checks remain authoritative. */
export function useEnvironmentController({
  visible,
  session,
  sessions,
  onClose,
  onOpenPanel,
  onSelectSession,
}: {
  visible: boolean;
  session?: SessionInfo;
  sessions: readonly SessionInfo[];
  onClose(): void;
  onOpenPanel(kind: 'review' | 'task'): void;
  onSelectSession(id: string): void;
}) {
  const validSession =
    session && !session.archived && sessions.some(item => item.id === session.id && item.cwd === session.cwd) ? session : undefined;
  // A new object for every identity/visibility transition also handles A → B → A.
  const scope = useMemo<EnvironmentScope>(
    () => ({ sessionId: visible ? validSession?.id : undefined, active: false, readEpoch: 0 }),
    [visible, validSession?.id, validSession?.cwd],
  );
  const currentScope = useRef(scope);
  // This is only a registry of live requests, never a repository/session snapshot cache.
  // Reopening the same target must not admit another mutation before its request settles.
  const pendingOperations = useRef(new Map<string, { token: symbol; kind: NonNullable<EnvironmentCardView['busy']> }>());
  const [stored, setStored] = useState(() => emptyState(scope));
  const state = stored.scope === scope ? stored : emptyState(scope);
  const current = (target: EnvironmentScope) => target.active && currentScope.current === target;
  const update = (target: EnvironmentScope, patch: Partial<EnvironmentState>) => {
    if (!current(target)) return;
    setStored(previous => ({ ...(previous.scope === target ? previous : emptyState(target)), ...patch }));
  };
  useLayoutEffect(() => {
    currentScope.current = scope;
    scope.active = true;
    setStored(emptyState(scope));
    return () => {
      scope.active = false;
      scope.readEpoch++;
    };
  }, [scope]);

  const read = (target: EnvironmentScope) => {
    const id = target.sessionId;
    if (!id || !current(target)) return;
    const epoch = ++target.readEpoch;
    const publish = (patch: Partial<EnvironmentState>) => {
      if (target.readEpoch === epoch) update(target, patch);
    };
    // Separate failures keep partial repository information useful. Async closures capture id once.
    void (async () => {
      try {
        publish({ status: await desktopClient.gitStatus(id), statusError: undefined });
      } catch (error) {
        publish({ status: undefined, statusError: String(error) });
      }
    })();
    void (async () => {
      try {
        publish({ branches: await desktopClient.gitBranches(id), branchError: undefined });
      } catch (error) {
        publish({ branches: undefined, branchError: String(error) });
      }
    })();
    void (async () => {
      try {
        publish({ worktrees: await desktopClient.gitWorktrees(id), worktreeError: undefined });
      } catch (error) {
        publish({ worktrees: undefined, worktreeError: String(error) });
      }
    })();
  };
  useEffect(() => {
    read(scope);
  }, [scope]);

  const taskBusy = !!validSession && (validSession.kind === 'terminal' || validSession.activity !== 'idle');
  const busy = scope.sessionId ? pendingOperations.current.get(scope.sessionId)?.kind : undefined;
  const locked = () => !!scope.sessionId && pendingOperations.current.has(scope.sessionId);
  const canMutate = !!scope.sessionId && current(scope) && !taskBusy && !!state.status && !locked();
  const canChangeStructure = canMutate && state.status!.files.length === 0;
  const run = async (kind: NonNullable<EnvironmentCardView['busy']>, action: (id: string, target: EnvironmentScope) => Promise<void>) => {
    const id = scope.sessionId;
    if (!id || !current(scope) || pendingOperations.current.has(id)) return;
    const token = Symbol(kind);
    pendingOperations.current.set(id, { token, kind }); // Synchronous across all displayed scopes of this target.
    scope.readEpoch++; // Earlier reads must not overwrite a mutation's result.
    const errorKey = kind === 'branch' ? 'branchError' : kind === 'worktree' ? 'worktreeError' : 'commitError';
    update(scope, { [errorKey]: undefined });
    let succeeded = false;
    try {
      await action(id, scope);
      succeeded = true;
    } catch (error) {
      update(scope, { [errorKey]: String(error) });
    } finally {
      if (pendingOperations.current.get(id)?.token === token) {
        pendingOperations.current.delete(id);
        const displayed = currentScope.current;
        if (displayed.sessionId === id && current(displayed)) {
          update(displayed, {}); // Reflect the released lock without reviving old UI state.
          if (succeeded || displayed !== scope) read(displayed);
        }
      }
    }
  };
  const intent = (event: EnvironmentIntent) => {
    if (event.type === 'close') {
      onClose();
      return;
    }
    if (!current(scope)) return;
    switch (event.type) {
      case 'open-panel':
        onClose();
        onOpenPanel(event.kind);
        break;
      case 'select-session':
        onClose();
        onSelectSession(event.id);
        break;
      case 'toggle-branches':
        update(scope, { showBranches: !state.showBranches });
        break;
      case 'toggle-worktrees':
        update(scope, { showWorktrees: !state.showWorktrees });
        break;
      case 'edit-branch':
        update(scope, { newBranch: event.value });
        break;
      case 'edit-worktree':
        update(scope, { newWorktreeBranch: event.value });
        break;
      case 'retry-read':
        if (!locked()) read(scope);
        break;
      case 'switch-branch':
        if (canChangeStructure && event.branch !== state.branches?.current)
          void run('branch', async (id, target) => {
            update(target, { status: await desktopClient.switchGitBranch(id, event.branch), showBranches: false });
          });
        break;
      case 'create-branch':
        if (canChangeStructure && state.newBranch.trim()) {
          const name = state.newBranch.trim();
          void run('branch', async (id, target) => {
            update(target, { status: await desktopClient.createGitBranch(id, name), newBranch: '' });
          });
        }
        break;
      case 'create-worktree':
        if (canChangeStructure && state.newWorktreeBranch.trim()) {
          const name = state.newWorktreeBranch.trim();
          void run('worktree', async (id, target) => {
            update(target, { worktrees: await desktopClient.createGitWorktree(id, name), newWorktreeBranch: '' });
          });
        }
        break;
      case 'delete-branch':
        if (canChangeStructure && event.branch !== state.branches?.current && state.branches?.branches.includes(event.branch))
          update(scope, {
            branchError: undefined,
            confirmation: { kind: 'delete-branch', sessionId: scope.sessionId!, target: event.branch },
          });
        break;
      case 'delete-worktree':
        if (canChangeStructure && state.worktrees?.worktrees.some(item => item.path === event.path && !item.current))
          update(scope, {
            worktreeError: undefined,
            confirmation: { kind: 'delete-worktree', sessionId: scope.sessionId!, target: event.path },
          });
        break;
      case 'open-commit':
        if (canMutate)
          update(scope, {
            commitError: undefined,
            confirmation: { kind: 'commit', sessionId: scope.sessionId!, fileCount: state.status!.files.length, message: '' },
          });
        break;
    }
  };
  const gitIntent = (event: EnvironmentGitIntent) => {
    const confirmation = state.confirmation;
    if (!current(scope) || !confirmation || confirmation.sessionId !== scope.sessionId) return;
    if (event.type === 'cancel') {
      if (!locked()) update(scope, { confirmation: undefined });
      return;
    }
    if (event.type === 'edit-message') {
      if (!locked() && confirmation.kind === 'commit') update(scope, { confirmation: { ...confirmation, message: event.value } });
      return;
    }
    if (!canMutate) return;
    if (event.type === 'confirm-delete' && canChangeStructure) {
      if (confirmation.kind === 'delete-branch')
        void run('branch', async (id, target) => {
          update(target, { branches: await desktopClient.deleteGitBranch(id, confirmation.target), confirmation: undefined });
        });
      if (confirmation.kind === 'delete-worktree')
        void run('worktree', async (id, target) => {
          update(target, { worktrees: await desktopClient.deleteGitWorktree(id, confirmation.target), confirmation: undefined });
        });
    }
    if (confirmation.kind === 'commit' && event.type === 'push')
      void run('commit', async (id, target) => {
        update(target, { status: await desktopClient.pushGitChanges(id), confirmation: undefined });
      });
    if (confirmation.kind === 'commit' && event.type === 'commit' && confirmation.fileCount > 0 && confirmation.message.trim())
      void run('commit', async (id, target) => {
        const status = await desktopClient.commitGitChanges(id, confirmation.message);
        // If push fails after a successful commit, retry offers push rather than another commit.
        update(target, { status, confirmation: { ...confirmation, fileCount: 0, message: '' } });
        if (event.push) update(target, { status: await desktopClient.pushGitChanges(id) });
        update(target, { confirmation: undefined });
      });
  };
  const view: EnvironmentCardView = {
    sessionAvailable: !!scope.sessionId,
    taskBusy,
    cwd: validSession?.cwd,
    status: state.status ? { branch: state.status.branch, fileCount: state.status.files.length } : undefined,
    statusError: state.statusError,
    branches: state.branches ? { current: state.branches.current, names: state.branches.branches } : undefined,
    worktrees: state.worktrees?.worktrees,
    backgroundProcesses: sessions
      .filter(item => item.kind === 'terminal' && item.processStatus !== 'exited')
      .map(item => ({
        id: item.id,
        title: item.title,
        activityLabel: item.activity === 'idle' ? '就绪' : item.activity === 'waiting-input' ? '等待输入' : '运行中',
      })),
    showBranches: state.showBranches,
    showWorktrees: state.showWorktrees,
    newBranch: state.newBranch,
    newWorktreeBranch: state.newWorktreeBranch,
    busy,
    branchError: state.branchError,
    worktreeError: state.worktreeError,
  };
  const confirmation = state.confirmation;
  const git: EnvironmentGitView = {
    confirmation,
    busy: !!busy,
    error:
      confirmation?.kind === 'delete-branch'
        ? state.branchError
        : confirmation?.kind === 'delete-worktree'
          ? state.worktreeError
          : state.commitError,
  };
  return { view, intent, git, gitIntent };
}

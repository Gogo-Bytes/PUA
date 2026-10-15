import type { SidebarSession, SessionPresentation as PublicPresentation } from '@pua/components';

export type SessionActivity = 'idle' | 'loading' | 'error';
export type SessionEnvironment = 'local' | 'remote' | 'remote-worktree' | 'worktree' | 'cloud';
export type SessionEntry =
  | { readonly kind: 'pending-start'; readonly status: 'other' | 'failed' | 'outcome-unknown' }
  | { readonly kind: 'worktree-start'; readonly phase: 'queued' | 'creating' | 'setting-up' | 'failed' | 'worktree-ready'; readonly needsAttention?: boolean }
  | { readonly kind: 'remote-task'; readonly latestTurn: 'in_progress' | 'pending' | 'failed' | 'other'; readonly hasUnreadTurn?: boolean };

/** Caller-normalized UI signals, not an Electron/IPC DTO or backend state machine. */
export interface SessionPresentation {
  readonly ownedWork?: boolean;
  readonly runtime?: 'systemError' | 'active' | 'other';
  readonly needsResume?: boolean;
  readonly latestTurnError?: boolean;
  readonly responseInProgress?: boolean;
  readonly publishing?: boolean;
  readonly entry?: SessionEntry;
  readonly attention?: { readonly kind: 'approval' | 'input'; readonly blocking?: boolean; readonly source?: 'mcp' | 'userInput' | 'userInputAsync'; readonly scheduled?: boolean; readonly progress?: number };
  readonly childApproval?: boolean;
  readonly suppressChildUnread?: boolean;
  readonly teamRoom?: boolean;
  readonly active?: boolean;
  readonly attentionIndicatorOnly?: boolean;
  readonly hideStatusIndicator?: boolean;
  readonly floatStatus?: boolean;
  readonly statusIndicatorReplacesMeta?: boolean;
  readonly archiveConfirmation?: boolean;
  readonly priorityIndicator?: string;
  readonly indicatorOverride?: string;
  readonly realtimeVoice?: boolean;
  readonly voiceIdentity?: boolean;
  readonly automation?: 'run' | 'attached';
  readonly eventSubscriptions?: boolean;
  readonly teamMembers?: readonly string[];
  readonly identity?: 'aeon' | 'environment-setup';
  readonly environment?: SessionEnvironment;
  /** Caller normalizes platform/feature/host prerequisites; false hides only the environment glyph. */
  readonly environmentVisible?: boolean;
  readonly environmentLabel?: string;
  readonly remoteUnavailable?: boolean;
  readonly archived?: boolean;
  /** This diagnostic badge is opt-in; it is not a normal five-state enum. */
  readonly subscription?: { readonly enabled: boolean; readonly streamRole?: 'leader' | 'follower'; readonly needsResume?: boolean; readonly runtimeActive?: boolean; readonly latestTurnInProgress?: boolean };
}

export interface SessionBadge {
  kind: 'working' | 'error' | 'unread' | 'input' | 'voice-active' | 'pin' | 'priority' | 'custom' | 'environment' | 'automation' | 'events' | 'voice' | 'team' | 'diagnostic' | 'identity';
  label: string;
  text?: string;
  tone?: 'info' | 'danger' | 'green' | 'purple' | 'yellow' | 'orange';
  progress?: number;
  pulsing?: boolean;
}
export interface SessionDisplay {
  visible: boolean;
  activity: SessionActivity;
  reason: string;
  disabled: boolean;
  hideQuickActions: boolean;
  confirmArchive: boolean;
  /** Always empty for Session rows; all indicators use the right metadata slot. */
  leading: SessionBadge[];
  chips: string[];
  badges: SessionBadge[];
  trailing: SessionBadge | null;
  floatStatus: boolean;
  labels: string[];
}
export interface SessionPresentationContext { readonly unread?: boolean; readonly pinned?: boolean; readonly active?: boolean }

export function normalizeProgress(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Source-traced d9n/Q1/_zo priorities, with explicit caller-owned display gates. */
export function resolveSessionPresentation(signal: SessionPresentation, context: SessionPresentationContext = {}): SessionDisplay {
  let activity: SessionActivity = 'idle', reason = 'default idle';
  if (signal.ownedWork) { activity = 'loading'; reason = 'owned work'; }
  else if (signal.runtime === 'systemError') { activity = 'error'; reason = 'systemError'; }
  else if (signal.runtime === 'active') { activity = 'loading'; reason = 'runtime active'; }
  else if (signal.needsResume) reason = 'needs_resume';
  else if (signal.latestTurnError) { activity = 'error'; reason = 'latest-turn error'; }
  else if (signal.responseInProgress) { activity = 'loading'; reason = 'response in progress'; }
  const entry = signal.entry;
  if (entry?.kind === 'pending-start') {
    activity = entry.status === 'other' ? 'loading' : 'error'; reason = `pending-start ${entry.status}`;
  } else if (entry?.kind === 'worktree-start') {
    activity = entry.phase === 'failed' ? 'error' : entry.phase === 'worktree-ready' ? 'idle' : 'loading'; reason = `worktree ${entry.phase}`;
  } else if (entry?.kind === 'remote-task') {
    activity = entry.latestTurn === 'failed' ? 'error' : ['in_progress', 'pending'].includes(entry.latestTurn) ? 'loading' : 'idle'; reason = `remote-task ${entry.latestTurn}`;
  }
  const active = signal.active ?? context.active ?? false;
  const attention = signal.attention;
  const blockingInput = attention?.kind === 'input' && !!attention.blocking;
  if ((blockingInput || signal.attentionIndicatorOnly) && activity === 'loading') { activity = 'idle'; reason += ' → loading suppressed'; }
  if (signal.publishing) { activity = 'loading'; reason = 'Cloud publishing override'; }
  let unread = !!(context.unread || entry?.kind === 'remote-task' && entry.hasUnreadTurn || entry?.kind === 'worktree-start' && entry.needsAttention);
  if (signal.attentionIndicatorOnly) unread = !!(unread || attention || signal.childApproval);
  if (signal.suppressChildUnread) unread = false;
  const chips: string[] = [];
  if (attention?.kind === 'approval' || signal.childApproval) chips.push('Awaiting approval');
  else if (attention?.source === 'userInputAsync' && !active && !signal.attentionIndicatorOnly) chips.push('Needs input');
  let trailing: SessionBadge | null = null;
  // _zo: statusPill precedes Q1; only the generic Q1 branch uses the hide gate.
  if (blockingInput && !active && !signal.attentionIndicatorOnly) {
    trailing = { kind: 'input', label: 'Needs input', text: 'Needs input', tone: 'info', ...(attention?.scheduled ? { progress: normalizeProgress(attention.progress) } : {}) };
  } else if (!signal.hideStatusIndicator && (activity === 'loading' || unread)) {
    if (activity === 'loading') trailing = { kind: 'working', label: 'Working' };
    else if (unread) trailing = { kind: 'unread', label: 'Unread', tone: 'info' };
  }
  // Explicit overrides are independent of the generic hideStatusIndicator gate.
  if (signal.indicatorOverride) trailing = { kind: 'custom', label: signal.indicatorOverride, tone: 'info' };
  if (signal.realtimeVoice) trailing = { kind: 'voice-active', label: 'Voice chat active', tone: 'info', pulsing: true };
  const leading: SessionBadge[] = [];
  if (signal.priorityIndicator) leading.push({ kind: 'priority', label: signal.priorityIndicator, tone: 'info' });
  else if (activity === 'error' && !signal.archiveConfirmation && !signal.statusIndicatorReplacesMeta) leading.push({ kind: 'error', label: entry?.kind === 'worktree-start' ? 'Worktree init failed' : 'Error', tone: 'danger' });
  else if (activity === 'idle' && context.pinned && !unread) leading.push({ kind: 'pin', label: 'Pinned' });
  const environment = signal.environment ?? (entry?.kind === 'worktree-start' ? 'worktree' : undefined);
  if (environment && environment !== 'local' && signal.environmentVisible !== false) leading.push({ kind: 'environment', label: signal.environmentLabel ?? ({ remote: 'Remote host', 'remote-worktree': 'Remote host · git worktree', worktree: 'Local git worktree', cloud: 'Cloud chat' }[environment]), text: environment, pulsing: entry?.kind === 'worktree-start' && activity === 'loading' });
  if (signal.identity) leading.push({ kind: 'identity', label: signal.identity === 'aeon' ? 'Aeon identity' : 'Cloud environment setup', text: signal.identity });
  // Source renderer slot names are not the Session navigation layout contract.
  const badges: SessionBadge[] = [...leading];
  if (signal.automation) badges.push({ kind: 'automation', label: signal.automation === 'run' ? 'Scheduled task run' : 'Scheduled task attached', text: signal.automation });
  if (signal.eventSubscriptions) badges.push({ kind: 'events', label: 'Event subscriptions' });
  if (signal.voiceIdentity) badges.push({ kind: 'voice', label: 'Voice chat' });
  if (signal.teamMembers?.length) badges.push({ kind: 'team', label: `Team: ${signal.teamMembers.join(', ')}`, text: signal.teamMembers.slice(0, 2).map(name => name.slice(0, 1)).join('') });
  const subscription = signal.subscription;
  if (subscription?.enabled) {
    let label: string, tone: SessionBadge['tone'];
    if (!subscription.streamRole) { label = subscription.needsResume ? 'Needs resume' : 'Read-only snapshot'; tone = subscription.needsResume ? 'danger' : 'orange'; }
    else if (subscription.streamRole === 'follower') { label = 'Subscribed: follower'; tone = 'purple'; }
    else if (subscription.runtimeActive || subscription.latestTurnInProgress) { label = 'Subscribed: active'; tone = 'green'; }
    else { label = 'Subscribed: idle'; tone = 'yellow'; }
    badges.push({ kind: 'diagnostic', label, tone });
  }
  const labels = [...new Set([...chips, ...badges.map(badge => badge.label), ...(trailing ? [trailing.label] : []), ...(signal.remoteUnavailable ? ['Remote host unavailable'] : [])])];
  return { visible: !signal.archived, activity, reason, disabled: !!signal.remoteUnavailable, hideQuickActions: !!signal.remoteUnavailable, confirmArchive: activity === 'loading' || signal.automation === 'attached', leading: [], chips, badges, trailing, floatStatus: false, labels };
}

/** Study-only adapter: source evidence is not the production Interface. */
export function toSidebarSession(session: StudySession): SidebarSession | null {
  const display = resolveSessionPresentation(session.presentation ?? {}, session);
  if (!display.visible) return null;
  const signal = session.presentation ?? {};
  const error = display.badges.find(badge => badge.kind === 'error');
  const environment = display.badges.find(badge => badge.kind === 'environment');
  const notice = display.badges.find(badge => ['priority', 'diagnostic'].includes(badge.kind)) ?? (display.trailing?.kind === 'custom' ? display.trailing : undefined);
  const { presentation: _study, ...data } = session;
  return {
    ...data,
    unread: display.trailing?.kind === 'unread',
    canPin: display.hideQuickActions ? false : data.canPin,
    primaryAction: display.hideQuickActions ? undefined : data.primaryAction,
    disabled: data.disabled || display.disabled,
    disabledReason: data.disabledReason ?? (display.disabled ? 'Remote host unavailable' : undefined),
    presentation: {
      execution: error ? { state: 'error', label: error.label } : display.trailing?.kind === 'working' ? { state: 'working' } : undefined,
      attention: display.chips.includes('Awaiting approval') ? { kind: 'approval' } : display.chips.includes('Needs input') ? { kind: 'input' } : display.trailing?.kind === 'input' ? { kind: 'input', style: 'pill', progress: display.trailing.progress } : undefined,
      environment: environment ? { kind: environment.text as NonNullable<PublicPresentation['environment']>['kind'], label: environment.label, starting: environment.pulsing } : undefined,
      identity: { kind: signal.identity, automation: signal.automation, voice: signal.voiceIdentity, liveVoice: display.trailing?.kind === 'voice-active', events: signal.eventSubscriptions, teamMembers: signal.teamMembers },
      notice: notice ? { label: notice.label, tone: notice.tone } : undefined,
    },
  };
}
export interface StudySession extends Omit<SidebarSession, 'presentation'> { readonly presentation?: SessionPresentation }

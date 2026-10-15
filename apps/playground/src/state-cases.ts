import type { SessionPresentation, StudySession as SidebarSession } from './study-presentation.ts';

export const stateGroups = [
  { id: 'runtime', title: '执行状态与优先级', source: 'd9n / f9n / oqo' },
  { id: 'unread', title: '未读与 Pin', source: 'Session unread / Q1 / IRo / fHo' },
  { id: 'attention', title: '审批与输入', source: 'oqo / Szo / T9n' },
  { id: 'identity', title: '语音、任务与身份', source: 'CZo / cXo / oqo' },
  { id: 'entry', title: '创建与远程任务', source: 'Q$o / RZo / jZo' },
  { id: 'environment', title: '环境与连接', source: 'n0 / n1o' },
  { id: 'diagnostic', title: '订阅诊断 · gated', source: 'mXo / hXo' },
  { id: 'display', title: '呈现门控与操作', source: '_zo / CZo' },
  { id: 'defensive', title: '输入防御 · 实现选择', source: 'Web normalization, not backend enum' },
] as const;
export type StateGroup = typeof stateGroups[number]['id'];
export interface StateCase { id: string; group: StateGroup; title: string; condition: string; source: string; session: SidebarSession }
const cases: StateCase[] = [];
function add(group: StateGroup, id: string, title: string, condition: string, signal: SessionPresentation = {}, extra: Partial<SidebarSession> = {}) {
  const key = `state:${id}`;
  cases.push({ id: key, group, title, condition, source: stateGroups.find(item => item.id === group)!.source,
    session: { id: key, title, canPin: true, primaryAction: { id: 'archive', label: '归档聊天', kind: 'archive' }, ...extra, presentation: { active: false, ...signal } } });
}
add('runtime', 'idle', '空闲 · 无完成勾号', '没有执行/错误信号 → idle；默认不画状态图标');
add('runtime', 'owned', 'Owned work 执行中', 'ownedWork=true → loading', { ownedWork: true });
add('runtime', 'system-error', '系统错误', 'runtime=systemError → error；右侧状态槽显示错误图标', { runtime: 'systemError' });
add('runtime', 'active', 'Runtime active', 'runtime=active → loading', { runtime: 'active' });
add('runtime', 'resume', '需要恢复 · 普通呈现 idle', 'needs_resume 本身不产生普通红点/完成 badge', { needsResume: true });
add('runtime', 'turn-error', '最近 Turn 错误', 'latestTurnError=true → error', { latestTurnError: true });
add('runtime', 'response', 'Response in progress', 'responseInProgress=true → loading', { responseInProgress: true });
add('runtime', 'owned-error', 'Owned work 优先于错误', 'ownedWork + systemError → loading，非 error', { ownedWork: true, runtime: 'systemError' });
add('runtime', 'active-error', 'Active 优先于 Turn 错误', 'runtime active + latestTurnError → loading', { runtime: 'active', latestTurnError: true });
add('runtime', 'resume-error', 'Needs resume 优先于 Turn 错误', 'needsResume + latestTurnError → idle', { needsResume: true, latestTurnError: true });
add('runtime', 'error-response', 'Turn 错误优先于 response', 'latestTurnError + responseInProgress → error', { latestTurnError: true, responseInProgress: true });
add('runtime', 'publishing', 'Cloud publishing 覆盖错误', 'publishing 强制 loading；不是后台任务 badge', { runtime: 'systemError', publishing: true, environment: 'cloud' });
add('runtime', 'publishing-input', 'Publishing 与阻塞输入', '基础 loading 被阻塞输入抑制，但 publishing 再强制 loading；pill 仍优先', { publishing: true, attention: { kind: 'input', blocking: true } });
add('unread', 'unread', '未读圆点', 'idle + unread=true，无数字计数', {}, { unread: true });
add('unread', 'working-unread', '执行中与未读', '单个 unread=true + runtime active → Working；不显示数字计数', { runtime: 'active' }, { unread: true });
add('unread', 'error-unread', '错误与未读可共存', 'Error 与单个 Unread 都在右侧状态槽；未读不表示成功', { runtime: 'systemError' }, { unread: true });
add('unread', 'pin', 'Pinned · idle rest', 'Pin 是独立轴，不是运行状态', {}, { pinned: true });
add('unread', 'pin-unread', '未读抑制 Pin rest', 'pinned + unread → 不画 resting Pin，保留 hover Pin 操作', {}, { pinned: true, unread: true });
add('unread', 'child-unread', 'Child unread suppression', 'child suppression 使 unread=false；不显示未读圆点', { suppressChildUnread: true }, { unread: true });
add('attention', 'approval', '等待审批', 'attention.kind=approval → Awaiting approval chip', { attention: { kind: 'approval' } });
add('attention', 'missing-requests', '缺少 requests / resume 信息', 'T9n 输入缺失 → caller 归一 attention=null；组件不解析 requests/恢复 DTO');
add('attention', 'resume-not-waiting', 'Needs resume · 未活跃等待', 'needs_resume 缺少 active waiting flags → caller 归一 attention=null；FXe/EPe 未恢复', { needsResume: true });
add('attention', 'child-approval', '子线程等待审批', 'childApproval=true 也产生审批 chip', { childApproval: true });
add('attention', 'blocking', '需要输入 · blocking', '非 active / 非 indicator-only，阻塞输入抑制 spinner，显示 Needs input pill', { runtime: 'active', attention: { kind: 'input', blocking: true, source: 'userInput' } });
add('attention', 'mcp-input', 'MCP form · 已归一输入', 'caller 将 form elicitation 归一为 blocking input；不在组件解析 MCP DTO', { attention: { kind: 'input', blocking: true, source: 'mcp' } });
add('attention', 'scheduled', 'Scheduled input · Snooze', 'scheduled 自动处理：静态 45% 进度；Snooze 仅本地 caller 意图', { runtime: 'active', attention: { kind: 'input', blocking: true, scheduled: true, progress: .45 } });
add('attention', 'async', '异步输入与 Working 共存', 'userInputAsync 非阻塞 → chip + spinner', { runtime: 'active', attention: { kind: 'input', source: 'userInputAsync', blocking: false } });
add('attention', 'approval-async', '审批 chip 优先于异步输入', 'childApproval + async input → 只保留审批 chip，Working 独立', { runtime: 'active', childApproval: true, attention: { kind: 'input', source: 'userInputAsync' } });
add('attention', 'active-input', 'Active row 隐藏 input pill', 'active=true：阻塞输入仍抑制 loading，pill 不显示', { active: true, runtime: 'active', attention: { kind: 'input', blocking: true } });
add('attention', 'active-async', 'Active row 隐藏 async chip', 'active=true，异步输入 chip 隐藏；Working 仍可见', { active: true, runtime: 'active', attention: { kind: 'input', source: 'userInputAsync' } });
add('attention', 'indicator-only', 'Attention indicator only', '抑制 loading/input；attention 转为单个 unread dot', { runtime: 'active', attentionIndicatorOnly: true, attention: { kind: 'input', blocking: true } });
add('identity', 'voice-active', '实时语音覆盖 Working', 'realtimeVoice=true → Voice chat active 呼吸点', { runtime: 'active', realtimeVoice: true });
add('identity', 'voice-input', '实时语音覆盖 input pill', '显式语音 override 高于 Needs input pill', { realtimeVoice: true, attention: { kind: 'input', blocking: true } });
add('identity', 'voice-identity', 'Voice chat 身份', 'Voice chat badge 与活跃语音点不同', { voiceIdentity: true });
add('identity', 'automation-run', '定时任务运行身份', 'Scheduled task run badge，可与 Working 共存', { automation: 'run', runtime: 'active' });
add('identity', 'automation-attached', '附加定时任务', 'Scheduled task attached badge；归档需 caller 确认', { automation: 'attached' });
add('identity', 'event', '事件订阅', '存在 event subscriptions → 独立附加图标', { eventSubscriptions: true });
add('identity', 'team', '共享 Team 身份', '附加 avatars / team 信息，不作为运行状态', { teamMembers: ['Alice', 'Bob'], eventSubscriptions: true });
add('identity', 'aeon', 'Aeon 身份图标', '身份图标，不推断为成功或 Working', { identity: 'aeon' });
add('identity', 'environment-setup', 'Cloud environment setup', '独立身份图标，不等于环境已完成', { identity: 'environment-setup' });
for (const status of ['other', 'failed', 'outcome-unknown'] as const) add('entry', `start-${status}`, `待创建 · ${status}`, status === 'other' ? '其他到达 pending-start 分支的值 → loading，非 Draft badge' : `${status} → error`, { entry: { kind: 'pending-start', status }, environment: 'cloud' });
for (const phase of ['queued', 'creating', 'setting-up', 'failed', 'worktree-ready'] as const) add('entry', `worktree-${phase}`, `工作树 · ${phase}`, phase === 'failed' ? 'error，错误标题 Worktree init failed' : phase === 'worktree-ready' ? 'idle；无完成勾号' : 'loading + 脉动环境图标', { entry: { kind: 'worktree-start', phase } });
add('entry', 'worktree-attention', '工作树 ready + attention', 'needsAttention 提供 unread，而不是完成标识', { entry: { kind: 'worktree-start', phase: 'worktree-ready', needsAttention: true } });
for (const latestTurn of ['in_progress', 'pending', 'failed', 'other'] as const) add('entry', `remote-${latestTurn}`, `远程任务 · ${latestTurn}`, 'in_progress/pending → loading；failed → error；其他 → idle', { entry: { kind: 'remote-task', latestTurn }, environment: 'remote' });
add('entry', 'remote-unread', '远程任务未读', 'task.has_unread_turn 是独立轴；不推断完成', { entry: { kind: 'remote-task', latestTurn: 'other', hasUnreadTurn: true }, environment: 'remote' });
for (const environment of ['local', 'remote', 'remote-worktree', 'worktree', 'cloud'] as const) add('environment', `env-${environment}`, `环境 · ${environment}`, '环境标识独立于 execution；Lucide 图形近似', { environment });
add('environment', 'cloud-hidden-feature', 'Cloud 图标 · feature 隐藏', 'n0 的 !oj gate 不满足 → caller environmentVisible=false；不隐藏整行', { environment: 'cloud', environmentVisible: false });
add('environment', 'cloud-unsupported-platform', 'Cloud 图标 · 不支持的平台', '不是 supported Electron / extension / chromeExtension → caller 不展示 Cloud glyph', { environment: 'cloud', environmentVisible: false });
add('environment', 'remote-missing-host', 'Remote 图标 · 缺少 hostId', '远程 glyph 需要 hostId；caller 已归一不展示，组件不持有 host DTO', { environment: 'remote', environmentVisible: false });
add('environment', 'remote-offline', '远程主机不可用', 'disabled + hide quick actions；不发明离线状态图标，保留 caller 管理菜单', { environment: 'remote', environmentLabel: 'dev-host', remoteUnavailable: true }, { allowMenuWhenDisabled: true, disabledReason: 'Remote host unavailable', menu: [{ type: 'action', id: 'manage-connection', label: 'Manage connection', icon: 'connection' }] });
add('environment', 'remote-offline-no-menu', '远程不可用 · 无管理能力', '没有 SSH/feature/callback 能力时不提供假管理操作', { environment: 'remote', remoteUnavailable: true });
const diagnostic = [
  { id: 'active', streamRole: 'leader' as const, runtimeActive: true },
  { id: 'follower', streamRole: 'follower' as const, runtimeActive: true },
  { id: 'idle', streamRole: 'leader' as const },
  { id: 'resume', needsResume: true },
  { id: 'snapshot' },
];
for (const { id, ...subscription } of diagnostic) add('diagnostic', `diag-${id}`, `订阅诊断 · ${id}`, '仅显式 feature enabled 时显示；不是普通五状态', { subscription: { enabled: true, ...subscription } });
add('diagnostic', 'diag-gate', '诊断 feature 关闭', 'enabled=false，即使 active 也不显示诊断点', { subscription: { enabled: false, streamRole: 'leader', runtimeActive: true } });
add('diagnostic', 'diag-progress', '诊断 latest-turn in progress', 'leader + latestTurnInProgress → 绿色 active', { subscription: { enabled: true, streamRole: 'leader', latestTurnInProgress: true } });
add('diagnostic', 'diag-no-role', '无 stream role 优先 snapshot', '无角色 + runtimeActive → Read-only snapshot，不是绿色 active', { subscription: { enabled: true, runtimeActive: true } });
add('display', 'hide-status', '隐藏通用 status indicator', 'hideStatusIndicator=true 隐藏 Working，不改变 activity', { runtime: 'active', hideStatusIndicator: true });
add('display', 'hidden-blocking-input', '隐藏 Q1 但保留 input pill', '_zo：statusPill 高于 generic Q1；hideStatusIndicator 不屏蔽阻塞输入 pill', { hideStatusIndicator: true, attention: { kind: 'input', blocking: true } });
add('display', 'float-status', 'Float 信号 · 统一右侧呈现', '保留来源信号，但本 Session 导航不使用额外左侧 rail；悬停仍切换为操作', { runtime: 'active', floatStatus: true });
add('display', 'priority', 'Priority 覆盖错误图标', 'priority > error；状态统一右侧呈现，底层 activity 仍 error', { runtime: 'systemError', priorityIndicator: 'Priority indicator' });
add('display', 'override', 'Explicit override 覆盖 input', '自定义 override > status pill / Q1；具体内容由 caller 提供', { attention: { kind: 'input', blocking: true }, indicatorOverride: 'Caller status override' });
add('display', 'hidden-override', 'Override 独立于通用 hide gate', 'hideStatusIndicator 只阻止通用 renderer，显式 override 独立', { runtime: 'active', hideStatusIndicator: true, indicatorOverride: 'Caller status override' });
add('display', 'error-meta', 'Meta replacement 抑制错误', '保留来源 gate；不额外显示错误图标', { runtime: 'systemError', statusIndicatorReplacesMeta: true });
add('display', 'error-confirm', '归档确认中抑制错误指示', 'archive-confirm UI gate；这是呈现门控，不是新 runtime 状态', { runtime: 'systemError', archiveConfirmation: true });
add('display', 'archived', '已归档 · row 不存在', '成功归档后不显示 row，也不画 Archived badge；可本地恢复', { archived: true });
add('display', 'archive-idle', '归档普通 idle 会话', '点 hover Archive 后本地移除；不是 archived 状态图标');
add('display', 'archive-working', '归档 Working · 需要确认', 'caller-owned 对话框，取消不移除', { runtime: 'active' });
add('defensive', 'progress-low', '进度下界', 'progress=-1 → 0；静态进度，不是真实 deadline', { attention: { kind: 'input', blocking: true, scheduled: true, progress: -1 } });
add('defensive', 'progress-high', '进度上界', 'progress=4 → 1', { attention: { kind: 'input', blocking: true, scheduled: true, progress: 4 } });
add('defensive', 'progress-invalid', '无效进度', 'progress=NaN → 0', { attention: { kind: 'input', blocking: true, scheduled: true, progress: NaN } });
export const stateCases: readonly StateCase[] = cases;

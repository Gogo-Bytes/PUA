# Pi 能力审计登记表

基线：仓库记录的 Pi 0.85.1 RPC 接入（见 `docs/native-chat-design.md`）。本表不是对 Pi 未公开能力的推断；升级 Pi 后重新核验。

状态含义：已接入（PUA 已有完整路径）；待接入（Pi 证据明确，PUA 尚未提供入口）；待验证（代码有迹象但需要运行验证）；待讨论（能力或交互会改变产品决策）。

## 已确认产品决策（2026-09-14）

- Session Tree / Fork：纳入一级任务能力。
- HTML 导出：不纳入产品。
- 模型与 Thinking Level：提供 PUA 任务级切换入口。
- Skills / Prompt Templates：采用 Codex 式 `@` 触发；输入时显示 tooltip 候选，用户可点击选择并插入引用。
- Pi 特有能力：保留，完成能力说明后分别设计 PUA 入口。
- 项目点击与历史创建：项目点击只创建本地未提交草稿；首次发送/开始工作时才调用 Pi 新会话并写入历史，避免重复点击产生空白历史。
- 任务生命周期：关闭默认归档；详情设置可恢复或二次确认永久删除。当前永久删除先清理对应 Pi 会话文件，再移除 PUA 索引，失败时保留记录。
- 归档自动清理：暂不启用；后续 7/30 天倒计时需要再次确认时区、提示、撤销窗口及 Pi 文件清理范围。
- 后台与窗口：允许单窗口后台驻留，关闭窗口隐藏到托盘，显式退出才停止 Pi 任务；不实现多窗口。
- 任务排序：置顶任务优先，其次按最近活动时间倒序，再以 ID 稳定排序。

待用户确认的默认实施假设：模型与 Thinking 入口放在 Composer 底部，分别打开原生选择菜单；切换通过 Pi `get_available_models` / `set_model` / `get_available_thinking_levels` / `set_thinking_level` 完成。若用户选择其他入口，仅调整呈现层，不删除这些受控能力。

补充决策：fork 入口放在每条可分支消息的操作区，调用 Pi 原生 `fork(entryId)`，并遵循 Pi 只允许从用户消息 entry 创建分支的约束。PUA 不为了模仿 Codex 擅自增加“新工作树”分支目标；若后续要把 Pi CLI 的 `--fork` 映射为独立工作树，会单独核验并讨论。Pi 特有能力全部保留；只有交互形态无法从 Codex 或 Pi 证据确定时才暂停讨论。

| ID | Pi 能力 | 证据 | PUA 状态 | 后续入口/验收 |
|---|---|---|---|---|
| PI-RPC-01 | prompt 与流式 delta | worker stream mapper、`ChatMessage` | 已接入 | 消息流、切换任务后恢复 |
| PI-RPC-02 | thinking / model / thinking level | `ChatSnapshot`、runtime mapper、Pi RPC `set_model` / `set_thinking_level` | 已接入 | Composer 控件按需查询 Pi 原生列表并切换；RPC prompt 不处理 TUI 内置 `/model` 与 `/thinking`，不得用插入命令冒充切换入口 |
| PI-RPC-03 | tool start/update/end 与最终结果 | stream core、ToolExecutionCard | 已接入 | 工具过程折叠、失败展开、重试 |
| PI-RPC-04 | agent settled / compacting / retrying | runtime activity；Pi RPC `compact` | 已接入 | 后台任务状态和通知；对话底部“压缩上下文”调用原生 compact，状态和失败由 Pi 事件回传 |
| PI-RPC-05 | steer / followUp / clear queue | conversation queue、worker protocol | 已接入 | Composer 队列可视化与任务级恢复 |
| PI-RPC-06 | history snapshot / continue | chat snapshot、create `continue`、Pi native session identity restore | 已接入（边界明确） | `continue` 只代表显式启动模式；重启恢复使用持久化 `sessionFile/sessionId`，项目草稿不写历史 |
| PI-RPC-07 | session name | rename command、session-info | 已接入 | 任务标题编辑与自动更新 |
| PI-RPC-08 | extension UI select/confirm/input/editor | Extension UI schema、Dialog | 已接入 | 任务上下文内等待态、焦点恢复 |
| PI-RPC-09 | extension UI notify/status/widget/title/editor text | runtime widgets/statuses | 已接入 | 全局通知中心与任务状态摘要 |
| PI-RPC-10 | `--resume` 历史选择器 | Pi 0.85.1 CLI `--resume, -r`；当前 `NewSessionDialog` 仅允许兼容终端使用 `startMode=resume`，主进程会原样追加 `--resume` | 部分接入 | 兼容终端入口可进入 Pi 原生历史选择器；RPC 原生对话使用已验证的持久化 identity，不伪造选择器 |
| PI-RPC-11 | fork / session tree / 分支历史 | Pi 0.85.1 rpc-client 明确发送 `fork`、`get_fork_messages`、`get_tree`；SessionManager 实现树遍历与 fork | 已接入（边界明确） | 消息级 Fork、用户 entry 白名单、侧栏入口与 `agent_settled` 后实时树元数据刷新已接入；不把 `entryId` 冒充 PUA Session id |
| PI-RPC-12 | 自定义 skill / prompt template 管理 | Pi CLI runtime 解析 `--skills`、`--prompt-templates`，resource loader 可加载 | 部分接入 | `@` Skill tooltip、命令面板和项目启动前资源/信任检查已接入；资源实际执行仍由 Pi 持有 |
| PI-RPC-13 | 自定义 extension command 与 custom UI | Pi extensions 文档确认 `registerCommand` 在 RPC 可通过 `get_commands` 暴露；`ctx.ui.custom()`、自定义 renderer/editor 依赖 TUI，在 RPC 中 `custom()` 返回 `undefined`（`docs/extensions.md` 970、2933） | 部分接入（边界明确） | RPC 命令继续进入命令面板；select/confirm/input/editor/notify/status/widget/title/editor text 已接入；TUI custom renderer/editor 继续由兼容终端承载，不伪造等价 DOM |
| PI-RPC-14 | token / usage 统计 | Pi 0.85.1 `AgentSession.getSessionStats()` / RPC `get_session_stats` 返回消息与工具计数、input/output/cache token、cost 和可选 contextUsage（tokens/contextWindow/percent） | 已接入 | 会话工具栏提供只读“会话统计”；明确标注为当前 Pi 会话统计，不伪装账户级用量 |
| PI-RPC-15 | 导出/复制历史 | RPC client 明确支持 `export_html`；包含 HTML export template 与 share viewer helper | 明确不做 | 不提供 HTML 导出入口；保留复制消息 |
| PI-RPC-16 | 跨设备/云端同步 | 本地 Pi 架构不提供 | 明确不做 | 不伪造 Codex 云能力 |
| PI-RPC-17 | 自动上下文压缩与自动重试开关 | Pi 0.85.1 `set_auto_compaction` / `set_auto_retry` RPC，`docs/rpc.md` 436–461；改变运行中的失败恢复与上下文策略 | 待讨论 | 保留 Pi 原生默认值；是否在任务详情或会话设置暴露受控开关，需要单独决定，不在 Codex 对标阶段擅自改变 |

## 每项能力的完成条件

待验证项必须提供版本、来源、命令/事件名、输入输出样例和失败语义；待接入项必须补齐 shared DTO、运行时 schema、main Adapter、renderer 入口和行为测试；待讨论项必须记录用户决定后才能进入实现排期。任何能力在证据不足时保持原 Pi 兼容入口，不删除已有终端能力。

## 本轮核验结果

当前仓库可以证明 RPC 流、工具、队列、扩展 UI、会话命名、继续会话、消息级 Fork、`get_tree` 元数据刷新、原生 `compact`、`get_session_stats` 和 session identity 恢复路径存在；本机 Pi 0.85.1 包的公开类型进一步显示 fork/tree、skills、prompt templates、HTML export 与 session stats 能力。usage 已按稳定 DTO 接入并做主进程边界校验。`--no-session` 明确保留为 Pi 原生内存能力，不进入 durable task index。

## Pi 0.85.1 RPC 命令映射（静态核验）

从安装包 `dist/modes/rpc/rpc-client.js` 解析到的命令集合：`prompt`、`steer`、`follow_up`、`abort`、`abort_bash`、`abort_retry`、`clear_queue`、`new_session`、`clone`、`fork`、`get_fork_messages`、`get_tree`、`switch_session`、`get_entries`、`get_messages`、`get_state`、`get_session_stats`、`get_last_assistant_text`、`get_available_models`、`set_model`、`cycle_model`、`get_available_thinking_levels`、`set_thinking_level`、`cycle_thinking_level`、`set_steering_mode`、`set_follow_up_mode`、`set_auto_compaction`、`set_auto_retry`、`compact`、`export_html`、`set_session_name`、`get_commands`、`bash`。

当前 PUA worker protocol 已覆盖 prompt/steer/followUp、stop、clear queue、extension response、rename、fork、模型/Thinking 查询与切换、compact 和部分会话查询；明确协议缺口仍包括 `switch_session`、`get_entries`、自动 compact/retry 设置、`export_html`、`clone`、`bash`。这些命令不应通过任意字符串透传，必须逐项加入白名单 DTO、响应校验、超时和生命周期测试。

### 已提取的参数契约（Pi 0.85.1）

`new_session(parentSession?)`、`set_model(provider, modelId)`、`set_thinking_level(level)`、`compact(customInstructions?)`、`export_html(outputPath)`、`switch_session(sessionPath)`、`fork(entryId)`、`get_entries(since?)`、`prompt/steer/follow_up(message, images)`；无参数查询包括 `get_state`、`get_messages`、`get_commands`、`get_tree`、`get_fork_messages`、`get_session_stats`、`get_available_models`、`get_available_thinking_levels`、`clone`。`bash(command)` 与 `abort_bash` 也存在，但 PUA 必须维持本地安全策略，不能因 Codex 对照而新增无审查 shell 入口。

## Pi 特有能力说明

- **Session Tree / Fork**：会话是带 `id/parentId` 的 JSONL 树，可从历史节点创建独立分支；PUA 应将分支显示为任务内结构。
- **Fork identity**：Pi 原生 `fork(entryId)` 会把当前运行时切换到新分支，同时保留旧 JSONL 分支。PUA 跟随 Pi 当前运行时更新任务的 `sessionId/sessionFile`，不伪造第二个任务或 worktree；旧分支仍由 Pi 的历史树/原生选择器管理。
- **Compaction**：Pi 生成 compaction summary 并沿当前叶子路径重建上下文；PUA 展示状态和失败反馈，不自行截断消息。
- **Extension UI**：扩展可请求 select、confirm、input、editor、notify、status、widget、title 和 editor text；RPC 对话可以承载这些 JSON 子协议。`ctx.ui.custom()`、自定义 renderer/editor 仍要求 TUI，RPC 返回 `undefined`，因此继续由兼容终端承载。
- **Skills / Prompt Templates**：Pi 从资源目录加载并通过命令目录暴露；PUA 的 `@` 是输入筛选器，执行逻辑仍由 Pi 持有。
- **Model / Thinking Level**：Pi 支持按会话查询和切换，PUA 不接管凭据或配置文件；模型与 Thinking Level 已通过真实 RPC 查询/切换，UI 菜单按需加载 Pi 返回的列表。
- **TUI custom 能力**：自定义主题、header/footer、renderer、editor 依赖终端绘制生命周期，RPC 没有等价 UI。
- **Session stats**：Pi 的 `/session` 统计属于当前本地会话的消息、工具、token、成本与上下文估算；PUA 只读展示该会话数据，不扩展为 Codex 账户用量、计费或跨设备统计。
- **自动策略**：Pi 可通过 `set_auto_compaction` 与 `set_auto_retry` 在当前 RPC 会话切换自动压缩/重试。它们不是只读状态，而是会改变任务失败恢复和上下文生命周期；PUA 暂不发送这两个命令，避免改变 Pi 原生默认值，入口与默认策略需产品单独确认。

## Fork 交互保留项

- 每条消息都保留 Fork 入口。
- Fork 入口必须保留 Pi 原生 `fork(entryId)`；仅对 Pi 标记为可分支的用户消息显示可点击操作，助手/工具/系统节点只作为历史树信息展示。独立新工作树不是当前 PUA RPC 的等价能力，不为视觉模仿伪造入口。
- 用户已确认分支展示方案：项目下保留主会话，分支作为可折叠缩进子节点，所有节点均可直接切换。此前“Codex 式 A/C”是设计提案标签，不作为 Codex 已实测行为的证据。
- 实施边界：Pi `get_tree` 是单会话历史树，节点 entryId 不等于 PUA Session id。Workspace 已按 Session id 聚合树；元数据刷新通过独立 `chat-fork-metadata` 事件，仅更新入口与树，不重放 transcript 或重置消息身份。关闭会话删除投影并忽略迟到事件；点击历史节点执行 Pi 原生 `fork(entryId)`，不能以伪造 `switch_session` 冒充切换。

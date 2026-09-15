# Pi 能力审计登记表

基线：仓库记录的 Pi 0.85.1 RPC 接入（见 `docs/native-chat-design.md`）。本表不是对 Pi 未公开能力的推断；升级 Pi 后重新核验。

状态含义：已接入（PUA 已有完整路径）；待接入（Pi 证据明确，PUA 尚未提供入口）；待验证（代码有迹象但需要运行验证）；待讨论（能力或交互会改变产品决策）。

## 已确认产品决策（2026-09-14）

- Session Tree / Fork：纳入一级任务能力。
- HTML 导出：不纳入产品。
- 模型与 Thinking Level：提供 PUA 任务级切换入口。
- Skills / Prompt Templates：采用 Codex 式 `@` 触发；输入时显示 tooltip 候选，用户可点击选择并插入引用。
- Pi 特有能力：保留，完成能力说明后分别设计 PUA 入口。

待用户确认的默认实施假设：模型与 Thinking 入口放在 Composer 底部，分别打开原生选择菜单；切换通过 Pi `get_available_models` / `set_model` / `get_available_thinking_levels` / `set_thinking_level` 完成。若用户选择其他入口，仅调整呈现层，不删除这些受控能力。

补充决策：fork 入口放在每条对话消息的操作区，点击后提供“在此工作空间中创建分支”和“在新工作树中创建分支”两个选项；前者沿用当前 Project/Task 上下文，后者创建新的工作树上下文。Pi 特有能力全部保留；只有交互形态无法从 Codex 或 Pi 证据确定时才暂停讨论。

| ID | Pi 能力 | 证据 | PUA 状态 | 后续入口/验收 |
|---|---|---|---|---|
| PI-RPC-01 | prompt 与流式 delta | worker stream mapper、`ChatMessage` | 已接入 | 消息流、切换任务后恢复 |
| PI-RPC-02 | thinking / model / thinking level | `ChatSnapshot`、runtime mapper、Pi RPC `set_model` / `set_thinking_level` | 部分接入 | 当前信息可展示；原生列表和切换仍待实现。RPC prompt 不处理 TUI 内置 `/model` 与 `/thinking`，不得用插入命令冒充切换入口 |
| PI-RPC-03 | tool start/update/end 与最终结果 | stream core、ToolExecutionCard | 已接入 | 工具过程折叠、失败展开、重试 |
| PI-RPC-04 | agent settled / compacting / retrying | runtime activity | 已接入 | 后台任务状态和通知 |
| PI-RPC-05 | steer / followUp / clear queue | conversation queue、worker protocol | 已接入 | Composer 队列可视化与任务级恢复 |
| PI-RPC-06 | history snapshot / continue | chat snapshot、create `continue` | 已接入 | 最近任务恢复；重启恢复需验证 |
| PI-RPC-07 | session name | rename command、session-info | 已接入 | 任务标题编辑与自动更新 |
| PI-RPC-08 | extension UI select/confirm/input/editor | Extension UI schema、Dialog | 已接入 | 任务上下文内等待态、焦点恢复 |
| PI-RPC-09 | extension UI notify/status/widget/title/editor text | runtime widgets/statuses | 已接入 | 全局通知中心与任务状态摘要 |
| PI-RPC-10 | `--resume` 历史选择器 | native-chat-design 记录 | 待接入 | 兼容终端入口；原生任务恢复流程 |
| PI-RPC-11 | fork / session tree / 分支历史 | Pi 0.85.1 rpc-client 明确发送 `fork`、`get_fork_messages`、`get_tree`；SessionManager 实现树遍历与 fork | 部分接入 | 消息级 Fork 已贯通白名单、响应校验、侧栏入口与实时元数据刷新；`get_tree` 分支树视图仍待接入 |
| PI-RPC-12 | 自定义 skill / prompt template 管理 | Pi CLI runtime 解析 `--skills`、`--prompt-templates`，resource loader 可加载 | 部分接入 | `@` Skill tooltip 与命令面板已接入；项目级资源入口与状态展示仍待接入 |
| PI-RPC-13 | 自定义 extension command 与 custom UI | TUI custom 能力有记录，RPC 等价不完整 | 待验证 | 明确降级到终端或设计桥接 |
| PI-RPC-14 | token / usage 统计 | Pi `FooterDataProvider` 暴露 context usage、session entries、model 信息；RPC DTO 尚未核对 | 待验证 | 核对 RPC usage 事件后增加任务级用量摘要 |
| PI-RPC-15 | 导出/复制历史 | RPC client 明确支持 `export_html`；包含 HTML export template 与 share viewer helper | 明确不做 | 不提供 HTML 导出入口；保留复制消息 |
| PI-RPC-16 | 跨设备/云端同步 | 本地 Pi 架构不提供 | 明确不做 | 不伪造 Codex 云能力 |

## 每项能力的完成条件

待验证项必须提供版本、来源、命令/事件名、输入输出样例和失败语义；待接入项必须补齐 shared DTO、运行时 schema、main Adapter、renderer 入口和行为测试；待讨论项必须记录用户决定后才能进入实现排期。任何能力在证据不足时保持原 Pi 兼容入口，不删除已有终端能力。

## 本轮核验结果

当前仓库可以证明 RPC 流、工具、队列、扩展 UI、会话命名、继续会话和消息级 Fork 路径存在；本机 Pi 0.85.1 包的公开类型进一步显示 fork/tree 事件、skills、prompt templates 与 HTML export 相关能力，但仍需核对 RPC 暴露方式和运行样例。usage 仍未找到可靠 DTO。下一轮优先核验 PI-RPC-10 至 PI-RPC-14。

## Pi 0.85.1 RPC 命令映射（静态核验）

从安装包 `dist/modes/rpc/rpc-client.js` 解析到的命令集合：`prompt`、`steer`、`follow_up`、`abort`、`abort_bash`、`abort_retry`、`clear_queue`、`new_session`、`clone`、`fork`、`get_fork_messages`、`get_tree`、`switch_session`、`get_entries`、`get_messages`、`get_state`、`get_session_stats`、`get_last_assistant_text`、`get_available_models`、`set_model`、`cycle_model`、`get_available_thinking_levels`、`set_thinking_level`、`cycle_thinking_level`、`set_steering_mode`、`set_follow_up_mode`、`set_auto_compaction`、`set_auto_retry`、`compact`、`export_html`、`set_session_name`、`get_commands`、`bash`。

当前 PUA worker protocol 只覆盖 prompt/steer/followUp、stop、clear queue、extension response、rename 和终端写入；以下是明确协议缺口：`fork`、`get_fork_messages`、`get_tree`、`switch_session`、`get_entries`、`get_messages`、`get_state`、`get_session_stats`、模型/思考级别查询与切换、自动 compact/retry 设置、`compact`、`export_html`、`clone`、`bash`。这些命令不应通过任意字符串透传，必须逐项加入白名单 DTO、响应校验、超时和生命周期测试。

### 已提取的参数契约（Pi 0.85.1）

`new_session(parentSession?)`、`set_model(provider, modelId)`、`set_thinking_level(level)`、`compact(customInstructions?)`、`export_html(outputPath)`、`switch_session(sessionPath)`、`fork(entryId)`、`get_entries(since?)`、`prompt/steer/follow_up(message, images)`；无参数查询包括 `get_state`、`get_messages`、`get_commands`、`get_tree`、`get_fork_messages`、`get_session_stats`、`get_available_models`、`get_available_thinking_levels`、`clone`。`bash(command)` 与 `abort_bash` 也存在，但 PUA 必须维持本地安全策略，不能因 Codex 对照而新增无审查 shell 入口。

## Pi 特有能力说明

- **Session Tree / Fork**：会话是带 `id/parentId` 的 JSONL 树，可从历史节点创建独立分支；PUA 应将分支显示为任务内结构。
- **Compaction**：Pi 生成 compaction summary 并沿当前叶子路径重建上下文；PUA 展示状态和失败反馈，不自行截断消息。
- **Extension UI**：扩展可请求 select、confirm、input、editor、notify、status、widget；custom renderer/editor 等 TUI 能力继续由兼容终端承载。
- **Skills / Prompt Templates**：Pi 从资源目录加载并通过命令目录暴露；PUA 的 `@` 是输入筛选器，执行逻辑仍由 Pi 持有。
- **Model / Thinking Level**：Pi 支持按会话查询和切换，PUA 不接管凭据或配置文件；模型与 Thinking Level 已通过真实 RPC 查询/切换，UI 菜单按需加载 Pi 返回的列表。
- **TUI custom 能力**：自定义主题、header/footer、renderer、editor 依赖终端绘制生命周期，RPC 没有等价 UI。

## Fork 交互保留项

- 每条消息都保留 Fork 入口。
- Fork 菜单必须保留“当前工作空间创建分支”和“新工作树创建分支”两个目标；当前仅完成消息级 RPC，目标选择器与树形投影仍待实现。

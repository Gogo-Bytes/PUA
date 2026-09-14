# Task Workspace 目标架构

## 统一语言

- Project：完整 cwd 标识及其展示名称。
- Task：用户在侧边栏看到、可恢复和可归档的工作单元。
- Session：Task 当前绑定的 Pi RPC 或 PTY 运行资源。
- Run：Task 一次发送/排队/停止的异步执行生命周期。
- Inspector：Task 作用域内的 Git、文件、分支和终端上下文。

## 所有权

Workspace 拥有项目树、当前 project/task、排序、折叠和布局投影。Task Store 拥有任务元数据、最近/归档/置顶、标题、草稿快照和恢复状态。Session 模块继续拥有进程生命周期和 Pi/PTY 资源。Conversation 继续拥有消息、工具、队列、附件和流式状态。Change Review 拥有 Git snapshot 与 diff。Preferences 只拥有桌面偏好，不成为任务权威。

## 目标状态

```text
TaskWorkspace
  projects: Project[]
  tasks: Task[]
  activeProjectId: string | null
  activeTaskId: string | null
  recentTaskIds: string[]
  archivedTaskIds: string[]
  layout: { leftOpen: boolean; rightOpen: boolean; leftWidth: number; rightWidth: number }

Task
  id, projectCwd, title, kind, createdAt, updatedAt
  status: idle | running | queued | failed | exited | archived
  sessionId?: string
  pinned: boolean
  draft: { revision: number; text: string; attachmentIds: string[] }
  view: { scrollTop: number; inspectorOpen: boolean }
```

任务元数据由 main 进程持有并通过 typed IPC 提供 snapshot/event；renderer 只保存投影和短生命周期输入状态。所有异步回写携带 taskId、sessionId 与 revision，防止切换任务后的旧请求污染当前任务。

## 分阶段实施

前置依赖：[Pi 能力盘点与差异决策](codex-interaction-parity.md#pi-能力盘点与差异决策记录)。先核对实际 Pi 版本及 RPC/CLI/SDK/扩展能力，识别 Pi 特有交互并与用户讨论。当前 Task 结构为待校正草案；不得仅以 Codex 截图或 PUA 当前 IPC 推断 Pi 的能力上限。

1. 建立 Task DTO、持久化存储端口、IPC snapshot/event 和 reducer；保留现有 Session 运行协议。
2. 用 GlobalNav、ProjectTree、TaskList 替换 ProjectNav/SessionTabs 的生产组合。
3. 接入任务生命周期与重启恢复，再接入任务栏操作和通知。
4. 将 Composer、Conversation、Inspector 绑定 Task scope，补齐后台运行与搜索。
5. 完成快捷键、窄窗、深链接、多窗口和完整回归旅程。

第一阶段完成标准：状态转换测试覆盖创建、切换、关闭、归档、恢复、后台运行和旧请求回写；IPC schema 可拒绝未知/无效任务状态；现有 Session/Conversation 测试保持通过。

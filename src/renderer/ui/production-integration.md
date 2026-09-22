# 生产接入与迁移契约

状态：`renderer/modules` 已完全退休；本文件保留生产接入契约和历史审计说明。生产领域组合位于对应 `renderer/features/*`，真正跨场景的交互能力位于 `renderer/ui`。通用封装原则见 [UI README](README.md)。

## 当前设计基准（2026-09-13）

用户已明确批准以当前 Component Preview 的组合交互页为生产设计基准，并要求实际替换与后续交互统一。此前“保留旧 DOM / 只换皮”的迁移约束已结束；不能再增加 transcript/nativeDetails 等生产视觉分支来恢复旧界面。Demo 的测试控制、模拟请求与 fixture 仍不得进入生产。

生产 App 使用 ResizableWorkspace、ProjectNav、带 InlineRename 的 SessionTabs、Breadcrumbs 与 InspectorHeader。面板按容器空间收缩、先隐藏右侧再隐藏左侧，宽度偏好恢复；不再使用 1100px 的旧 Inspector overlay。检查器内 Escape 与关闭按钮恢复 toggle，输入框和本地菜单保留 Escape。Git scope 与 Markdown source/preview 使用共享 Tabs 的方向键导航。

会话 pane 仍以 session.id 常驻；Session/Conversation/Git/backend/IPC 所有权不变。视觉与交互允许调整，异步提交身份、草稿 revision、附件 token、安全 Content 渲染与 xterm 生命周期仍是回归约束。后续 UI 改动先在同一组件体系中实现，再供生产与预览共同消费。

## Composer：调用方契约

类型：`ComposerProps`、`ComposerSubmission`、`ComposerAttachment`、`ComposerLabels`，现定义于 `renderer/features/conversation/Composer.tsx`。

视觉：输入容器使用 20px 圆角与浅阴影；附件入口位于工具区左侧，发送/排队使用圆形图标按钮，保留由 labels 提供的可访问名称及 title。输入框键盘焦点环显示在整个容器，其他按钮保留各自焦点环。未增加无对应能力的模型、权限或语音入口。

- 必传 `conversationKey`、`value` / `onValueChange`、`attachments`。调用方持有每个会话的真实草稿和附件；附件使用稳定唯一 id、不可变数组/对象。`onAddAttachments` / `onRemoveAttachment(id)` 仅报告意图，文件选择、验证和失败展示由调用方负责。
- `onSend(submission)` 和 `onQueue(submission)` 接收 `{ conversationKey, value, attachments }` 快照；保留原始草稿空白，附件复制为提交快照。纯空白且无附件不可提交，只有附件可以提交。
- 输入区底栏将附件入口、模型、思考程度、压缩和统计放在同一组紧凑控件中；模型与思考选项仍按当前会话懒加载并通过原有 IPC 提交。命令建议在当前 `/` token 下弹出，项目技能与项目文件在当前 `@` token 下弹出，选择后只替换该 token 并恢复编辑器焦点；Escape 关闭建议，ArrowDown/ArrowUp 在建议列表中移动。文件引用沿用受控的 `@"path"` 文本协议，提交仍经过现有 `sendChatMessage` 快照。
- `busy` 表示模型运行，而不是禁用输入：可继续编辑、增删附件；有 `onQueue` 时主按钮变成排队，有 `onStop` 时显示独立停止按钮。`queuedCount` 是调用方队列的展示值。没有对应 callback 不展示虚假的操作按钮。
- `disabled` 才整体锁定输入和操作。异步提交锁防止重复发送/排队；停止有独立 pending 锁，可在排队请求未结束时停止。Enter 提交，Shift+Enter 换行，Ctrl/Meta+Enter 不误提交；composition / isComposing / 229 不触发编辑器命令或提交。可选 onFollowUp 在 busy 时接收 Alt+Enter，和 send/queue 共用提交锁。editorRef 用于生产命令菜单与引用聚焦；onEditorKeyDown 在 IME guard 后调用，preventDefault 可消费本地导航。自动高度在同一 Composer 内管理。
- 组件**永不清空**草稿或附件，也不内置模拟 timer。callback reject 时保留数据并展示错误，resolve 时只解除内部 pending。
- 调用方若选择成功后清空，应按提交时的会话身份和草稿版本做条件更新；不能在 `await` 后无条件清空当前会话。`conversationKey` 改变会重建内部 pending/error 生命周期（包括 A→B→A），外部草稿或附件替换会使旧错误失效。旧请求完成不会写入新内部状态，但**不能取消调用方自己的副作用**；真实请求取消和回写版本校验仍由调用方完成。
- `labels` 是小型文案对象，包含 textarea、placeholder、提示、发送/排队/停止、附件增删、队列计数与失败文案。业务错误的语言由 callback 提供。

预览的 `CompletionExamples.tsx / ComposerPreview` 是独立内存 Adapter：受控会话草稿、附件、提交后按快照清空、650ms 模拟失败、运行/排队/停止。所有模拟延时仅存在于 preview，卸载时清理；这不是 Pi 或真实附件实测。

## ChatMessage：对话展示，不是通知

`ChatMessageProps`（现位于 `renderer/features/conversation/ChatMessage.tsx`）：`role` 为 user / assistant / system / custom / summary，`author` 必传，`metadata`、`children` 正文、`actions` 均为 ReactNode。字符串始终作为文本；调用方可通过正文 slot 提供已审核的受控渲染器。`streaming` 展示状态并将正文标记 aria-busy，不对每个 token 创建 live region；`error` 保留正文并复用静态 Message。角色、流式和失败标签可通过 `labels` 配置。作者与角色默认视觉隐藏但保留可访问文字，metadata 独立展示；actions 始终可见（键盘、触屏无需 hover）。用户正文右对齐浅底，助手使用裸正文。字符串保留换行，React slot 按正常块排版；段落、章节、列表、代码、引用、表格与链接样式仅作用于正文。排版规则见 [注意力层级](typography-and-hierarchy.md)。

隔离预览不直接复用生产 `features/content/MarkdownView`；生产同一 ChatMessage 接受调用方传入的已审核正文。ContentView 迁移未改变渲染实现，也未新增不受控 HTML 渲染或桥接后门。

正文支持受控 React 内容中的 mark 高亮、kbd 快捷键、ins/del 变更行、dl 术语、details 折叠、figure/figcaption 与脚注锚点。`ui-code-keyword/string/number/comment` 为调用方已审核语法片段的配色类；不自动解析或执行代码。静态任务清单以图标加明确文字表达完成/待检查，不伪装成可操作的复选框。完整样例位于预览 `DocumentExamples.tsx`，不从模块入口导出。

## 生产组件与状态边界

- 当前生产左栏使用 `ProjectSidebar` 的项目/会话嵌套菜单。文件夹图标按钮承担折叠，展开时为打开文件夹；项目名称仍进入新对话草稿。会话无前置图标，与项目共用整行高亮、末端浮层操作；按钮透明，hover 只改变图标色。操作在 hover、键盘焦点进入时显示，当前会话和触屏常显；重命名时隐藏末端浮层以免遮挡编辑器。关注/运行状态保留在末端。专项隔离浏览器验收：启动 4181 Workspace Preview 后运行 `node tests/sidebar-menu-check.mjs`，明暗与窄窗截图输出到 `/tmp/pua-sidebar-menu`。

- ProjectNav 以 cwd 为身份，生产保留筛选，路径退到 Tooltip/title，使用与 demo 相同的名称行。SessionTabs 的双击/F2 改名绑定被编辑 tab 的 id；切换当前会话不改变提交目标。Chat 改名等待 host；Terminal 名称仍仅更新本地。关闭、overflow、方向键导航和 activity 状态继续可用。
- GitPanel 继续持有 Git status、scope、selected path、刷新 generation 和 diff 请求。InspectorHeader 与 FileRow 只报告用户意图；参数快照、非原子读取说明、冲突 patch 与引用语义保留。
- ToolExecutionCard 统一使用受控 Collapsible/GSAP，成功默认收起，失败自动展开，用户展开状态跨更新保留。参数、图片、输出快照与复制仍来自原 Tool owner。旧 nativeDetails 分支已移除。
- ChatMessage 统一使用作者可访问但视觉隐藏、用户右侧 bubble、助手裸正文与 actions。Content Feature 继续负责 Markdown、流式修补、复制、external-link 与远程图片阻断；不向通用 UI 下沉 Desktop 能力。
- Composer 不再有 transcript 分支。ChatPane 仍持有草稿 revision、附件 token、提交快照清理、send/steer/follow-up/stop host 调用与命令菜单。共享 Composer 管理 IME、局部 pending、键盘提交与呈现；运行中可引导或 Alt+Enter 后续，并独立停止。
- `app/production.css` 是唯一生产样式入口。Feature CSS 只分配常驻 pane、Virtuoso 阅读列、Composer dock 与内容快照空间；不得覆盖统一控件回到旧布局。`renderer/modules`、顶层 ContentView/styles/review 继续退休。

## 隔离验证

Component Preview 四个浏览器脚本验证共同组件；Workspace Preview 复用完整生产 App/production.css 和 Fake Desktop。运行 `node tests/workspace-demo-check.mjs` 检查生产布局、改名、调宽、面板恢复、消息/工具/输入、主题与 Dialog；`node tests/workspace-dialog-check.mjs` 覆盖 pending 表单焦点。两者只访问 127.0.0.1:4181。Electron 验证使用临时 userData 和本地 mock runtime，只查看空壳与 Settings，不创建会话或访问真实外部能力。

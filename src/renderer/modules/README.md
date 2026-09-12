# 工作台模块迁移契约

状态：`renderer/modules` 运行时代码与聚合入口已退休；本文件暂时保留迁移契约和历史审计说明。生产领域组合位于对应 `renderer/features/*`，真正跨场景的交互能力位于 `renderer/ui`。通用封装原则见 [ui README](../ui/README.md)。

## Composer：调用方契约

类型：`ComposerProps`、`ComposerSubmission`、`ComposerAttachment`、`ComposerLabels`，现定义于 `renderer/features/conversation/Composer.tsx`。

视觉：输入容器使用 20px 圆角与浅阴影；附件入口位于工具区左侧，发送/排队使用圆形图标按钮，保留由 labels 提供的可访问名称及 title。输入框键盘焦点环显示在整个容器，其他按钮保留各自焦点环。未增加无对应能力的模型、权限或语音入口。

- 必传 `conversationKey`、`value` / `onValueChange`、`attachments`。调用方持有每个会话的真实草稿和附件；附件使用稳定唯一 id、不可变数组/对象。`onAddAttachments` / `onRemoveAttachment(id)` 仅报告意图，文件选择、验证和失败展示由调用方负责。
- `onSend(submission)` 和 `onQueue(submission)` 接收 `{ conversationKey, value, attachments }` 快照；保留原始草稿空白，附件复制为提交快照。纯空白且无附件不可提交，只有附件可以提交。
- `busy` 表示模型运行，而不是禁用输入：可继续编辑、增删附件；有 `onQueue` 时主按钮变成排队，有 `onStop` 时显示独立停止按钮。`queuedCount` 是调用方队列的展示值。没有对应 callback 不展示虚假的操作按钮。
- `disabled` 才整体锁定输入和操作。异步提交锁防止重复发送/排队；停止有独立 pending 锁，可在排队请求未结束时停止。Enter 提交，Shift+Enter 换行，composition / isComposing / 229 的 Enter 不提交。
- 组件**永不清空**草稿或附件，也不内置模拟 timer。callback reject 时保留数据并展示错误，resolve 时只解除内部 pending。
- 调用方若选择成功后清空，应按提交时的会话身份和草稿版本做条件更新；不能在 `await` 后无条件清空当前会话。`conversationKey` 改变会重建内部 pending/error 生命周期（包括 A→B→A），外部草稿或附件替换会使旧错误失效。旧请求完成不会写入新内部状态，但**不能取消调用方自己的副作用**；真实请求取消和回写版本校验仍由调用方完成。
- `labels` 是小型文案对象，包含 textarea、placeholder、提示、发送/排队/停止、附件增删、队列计数与失败文案。业务错误的语言由 callback 提供。

预览的 `CompletionExamples.tsx / ComposerPreview` 是独立内存 Adapter：受控会话草稿、附件、提交后按快照清空、650ms 模拟失败、运行/排队/停止。所有模拟延时仅存在于 preview，卸载时清理；这不是 Pi 或真实附件实测。

## ChatMessage：对话展示，不是通知

`ChatMessageProps`（现位于 `renderer/features/conversation/ChatMessage.tsx`）：`role` 为 user / assistant / system / custom / summary，`author` 必传，`metadata`、`children` 正文、`actions` 均为 ReactNode。字符串始终作为文本；调用方可通过正文 slot 提供已审核的受控渲染器。`streaming` 展示状态并将正文标记 aria-busy，不对每个 token 创建 live region；`error` 保留正文并复用静态 Message。角色、流式和失败标签可通过 `labels` 配置。作者与角色默认视觉隐藏但保留可访问文字，metadata 独立展示；actions 始终可见（键盘、触屏无需 hover）。用户正文右对齐浅底，助手使用裸正文。字符串保留换行，React slot 按正常块排版；段落、章节、列表、代码、引用、表格与链接样式仅作用于正文。排版规则见 [注意力层级](../ui/typography-and-hierarchy.md)。

隔离预览不直接复用生产 `features/content/MarkdownView`；生产 transcript variant 只接受调用方传入的已审核正文。ContentView 迁移未改变渲染实现，也未新增不受控 HTML 渲染或桥接后门。

正文支持受控 React 内容中的 mark 高亮、kbd 快捷键、ins/del 变更行、dl 术语、details 折叠、figure/figcaption 与脚注锚点。`ui-code-keyword/string/number/comment` 为调用方已审核语法片段的配色类；不自动解析或执行代码。静态任务清单以图标加明确文字表达完成/待检查，不伪装成可操作的复选框。完整样例位于预览 `DocumentExamples.tsx`，不从模块入口导出。

## 已迁出的模块

ProjectNav 与 SessionTabs 已迁入 `renderer/features/workspace` 并由生产 App 和隔离预览共同消费；ProjectNav 保留 cwd callback 身份、生产筛选与路径显示，并让预览继续只在重名时通过 Tooltip 显示完整路径。SessionTabs 保留生产关闭/overflow/键盘导航，同时仅在预览提供 `onRename` / `onAdd` 时启用 InlineRename；生产改名仍由原 Session Dialog owner 处理。

InspectorHeader 与 FileRow 已迁入 `renderer/features/change-review` 并接入生产 GitPanel。Git 状态、scope、selected path、刷新 generation 和 diff 请求仍由 GitPanel 持有；两个展示组件只转发既有 callback，预览继续使用本地 callback。

ToolExecutionCard 已迁入 `renderer/features/conversation` 并接入生产 ToolCard。预览仍使用 Collapsible 的 GSAP seam 与统一可访问名称；生产通过 `nativeDetails` 保留原生 details/summary、成功默认收起、失败自动展开、展开状态跨运行更新保留，以及参数、图片、输出快照和复制行为。Tool activity 与消息 block owner 不变。

ChatMessage 已迁入 Conversation Feature，并通过 `transcript` variant 接入生产 MessageView。生产仍保留原 `chat-message` / `message-body` DOM seam、作者 header、CopyButton、MarkdownView、thinking、图片、工具 block 与错误位置；组件本身不取得 clipboard、链接、stream reducer 或消息 owner。

Composer 已迁入 Conversation Feature，并通过 `transcript` variant 接入生产 ChatPane。该 variant 只提供原 `.composer` DOM seam；textarea ref、IME guard、draft revision、附件 token、send/steer/follow-up/stop 锁、清理 continuation、命令菜单和错误发布仍由 ChatPane 持有。隔离 Preview 继续使用受控 ComposerProps 与本地内存 Adapter。`modules/index.ts` 与 `modules.css` 已删除，不再存在 renderer modules 运行时聚合层。

顶层 ContentView 已迁入 `renderer/features/content`。Conversation 与 Change Review 经 Feature index 共用 CopyButton、MarkdownView 与 SourceView；clipboard、external-link、Markdown 插件、流式修补、远程图片阻断和源码 DOM 仍由原实现负责，没有下沉到无 Desktop 依赖的通用 UI。

顶层 `review.css` 与 `styles.css` 已退休。生产样式由 `app/production.css` 按原 cascade 顺序装配 app/Feature stylesheets；组件 Preview 继续显式加载隔离样式，Workspace Preview 复用生产入口。

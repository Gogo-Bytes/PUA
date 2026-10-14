# 生产接入与迁移契约

状态：`renderer/modules` 已完全退休；本文件保留生产接入契约和历史审计说明。生产领域组合位于对应 `renderer/features/*`，真正跨场景的交互能力位于 `renderer/ui`。通用封装原则见 [UI README](README.md)。

## 当前设计基准（2026-09-13）

用户已明确批准以当前 Component Preview 的组合交互页为生产设计基准，并要求实际替换与后续交互统一。此前“保留旧 DOM / 只换皮”的迁移约束已结束；不能再增加 transcript/nativeDetails 等生产视觉分支来恢复旧界面。Demo 的测试控制、模拟请求与 fixture 仍不得进入生产。

生产 App 使用 ResizableWorkspace、带 InlineRename 的 ProjectSidebar、Breadcrumbs 与 InspectorHeader；ProjectNav/SessionTabs 仍作为预览与可复用组合保留。面板按容器空间收缩：有环境辅助列时先隐藏环境，再压缩主要面板，仍不足时先隐藏右侧再隐藏左侧，宽度偏好恢复；不再使用 1100px 的旧 Inspector overlay。检查器内 Escape 与关闭按钮恢复 toggle，输入框和本地菜单保留 Escape。Git scope 与 Markdown source/preview 使用共享 Tabs 的方向键导航。

会话 pane 仍以 session.id 常驻；Session/Conversation/Git/backend/IPC 所有权不变。视觉与交互允许调整，异步提交身份、草稿 revision、附件 token、安全 Content 渲染与 xterm 生命周期仍是回归约束。后续 UI 改动先在同一组件体系中实现，再供生产与预览共同消费。

## Composer：调用方契约

类型：`ComposerProps`、`ComposerSubmission`、`ComposerAttachment`、`ComposerLabels`，现定义于 `renderer/features/conversation/Composer.tsx`。

视觉：输入容器使用 20px 圆角与浅阴影；附件入口位于工具区左侧，发送/排队使用圆形图标按钮，保留由 labels 提供的可访问名称及 title。按用户要求不显示发送快捷键提示、不显示点击/焦点外框；按钮键盘焦点使用文字下划线/图标颜色提示，文本框保留 caret。未增加无对应能力的模型、权限或语音入口。

- 必传 `conversationKey`、`value` / `onValueChange`、`attachments`。调用方持有每个会话的真实草稿和附件；附件使用稳定唯一 id、不可变数组/对象。`onAddAttachments` / `onRemoveAttachment(id)` 仅报告意图，文件选择、验证和失败展示由调用方负责。
- `onSend(submission)` 和 `onQueue(submission)` 接收 `{ conversationKey, value, attachments }` 快照；保留原始草稿空白，附件复制为提交快照。纯空白且无附件不可提交，只有附件可以提交。
- 输入区底栏只保留附件入口、模型和思考程度。已有会话按当前 session 懒加载 Pi RPC 目录并用 RPC 更新；新对话仅在打开模型选择时，经 Desktop IPC 调用 Pi `--list-models` 读取目录（离线、无 session、禁用 extensions、cwd 固定 home），所选模型/思考档位作为经过 schema 校验的初始 Chat 参数，在第一次创建 session 时加入 argv；不为草稿预启动 Pi。Pi CLI 不可读目录时保留 Pi 默认选项。`/compact [要求]`、`/stats` 是已有会话的本地命令入口，选择只插入，提交才调用 typed compact/stats IPC，不将它们作为 prompt 发送。压缩要求 idle；带附件的本地命令拒绝执行并保留草稿/附件，失败与等待期新输入沿用 revision 保护。其他命令建议在当前 `/` token 下弹出，项目技能与项目文件在当前 `@` token 下弹出，选择后只替换该 token 并恢复编辑器焦点；Escape 关闭建议，ArrowDown/ArrowUp 在建议列表中移动。文件引用沿用受控的 `@"path"` 文本协议。
- `busy` 表示模型运行，而不是禁用输入：可继续编辑、增删附件；有 `onQueue` 时主按钮变成排队，有 `onStop` 时显示独立停止按钮。`queuedCount` 是调用方队列的展示值。没有对应 callback 不展示虚假的操作按钮。
- `disabled` 才整体锁定输入和操作。异步提交锁防止重复发送/排队；停止有独立 pending 锁，可在排队请求未结束时停止。Enter 提交，Shift+Enter 换行，Ctrl/Meta+Enter 不误提交；composition / isComposing / 229 不触发编辑器命令或提交。可选 onFollowUp 在 busy 时接收 Alt+Enter，和 send/queue 共用提交锁。editorRef 用于生产命令菜单与引用聚焦；onEditorKeyDown 在 IME guard 后调用，preventDefault 可消费本地导航。自动高度在同一 Composer 内管理。
- 组件**永不清空**草稿或附件，也不内置模拟 timer。callback reject 时保留数据并展示错误，resolve 时只解除内部 pending。
- 调用方若选择成功后清空，应按提交时的会话身份和草稿版本做条件更新；不能在 `await` 后无条件清空当前会话。`conversationKey` 改变会重建内部 pending/error 生命周期（包括 A→B→A），外部草稿或附件替换会使旧错误失效。旧请求完成不会写入新内部状态，但**不能取消调用方自己的副作用**；真实请求取消和回写版本校验仍由调用方完成。
- `labels` 是小型文案对象，包含 textarea、placeholder、提示、发送/排队/停止、附件增删、队列计数与失败文案。业务错误的语言由 callback 提供。

预览的 `CompletionExamples.tsx / ComposerPreview` 是独立内存 Adapter：受控会话草稿、附件、提交后按快照清空、650ms 模拟失败、运行/排队/停止。所有模拟延时仅存在于 preview，卸载时清理；这不是 Pi 或真实附件实测。

## ChatMessage：对话展示，不是通知

`ChatMessageProps`（现位于 `renderer/features/conversation/ChatMessage.tsx`）：`role` 为 user / assistant / system / custom / summary，`author` 必传，`metadata`、`children` 正文、`actions` 均为 ReactNode。字符串始终作为文本；调用方可通过正文 slot 提供已审核的受控渲染器。`streaming` 展示状态并将正文标记 aria-busy，不对每个 token 创建 live region；`error` 保留正文并复用静态 Message。角色、流式和失败标签可通过 `labels` 配置。作者与角色默认视觉隐藏但保留可访问文字，metadata 独立展示；actions 始终可见（键盘、触屏无需 hover）。用户正文右对齐浅底，助手使用裸正文。字符串保留换行，React slot 按正常块排版；段落、章节、列表、代码、引用、表格与链接样式仅作用于正文。排版规则见 [注意力层级](typography-and-hierarchy.md)。

隔离预览不直接复用生产 `features/content/MarkdownView`；生产同一 ChatMessage 接受调用方传入的已审核正文。生产 ChatPane 与 GitPanel 通过 `LazyMarkdownView` 按需加载 Markdown、GFM 和代码着色依赖，加载占位只表示渲染尚未完成，不改变数据所有权、IPC 边界或安全策略。ContentView 迁移未改变渲染实现，也未新增不受控 HTML 渲染或桥接后门。

正文支持受控 React 内容中的 mark 高亮、kbd 快捷键、ins/del 变更行、dl 术语、details 折叠、figure/figcaption 与脚注锚点。`ui-code-keyword/string/number/comment` 为调用方已审核语法片段的配色类；不自动解析或执行代码。静态任务清单以图标加明确文字表达完成/待检查，不伪装成可操作的复选框。完整样例位于预览 `DocumentExamples.tsx`，不从模块入口导出。

## 生产组件与状态边界

- 当前生产左栏使用 `ProjectSidebar` 的项目/会话嵌套菜单。文件夹图标按钮承担折叠，展开时为打开文件夹；项目名称仍进入新对话草稿。会话无前置图标，与项目共用整行高亮、末端浮层操作；按钮透明，hover 只改变图标色。操作在 hover、键盘焦点进入时显示，当前会话和触屏常显；重命名时隐藏末端浮层以免遮挡编辑器。关注/运行状态保留在末端。专项隔离浏览器验收：启动 4181 Workspace Preview 后运行 `node tests/sidebar-menu-check.mjs`，明暗与窄窗截图输出到 `/tmp/pua-sidebar-menu`。

- 生产 ProjectSidebar 不再显示项目过滤输入框，顶部搜索与命令入口保留。PendingChatPane 仍无 session id；独立的只读模型目录不需要 session identity。Pi 凭据和信任文件仍完全由 Pi 管理，PUA 不直接读取。

- 侧栏按用户截图进一步对齐：项目末端固定为“更多 / 新建对话”，更多菜单承载打开目录、复制路径与兼容终端；当前打开目录的宿主能力依赖 session id，空项目禁用该项。Chat 会话末端为“钉选 / 归档”，归档仍经真实 closeSession → 进程关闭 → archiveSession 持久化，失败保留条目、运行中沿原生确认；Terminal 无持久归档，明确标为关闭终端，不冒充历史归档。

- ProjectNav 以 cwd 为身份，生产保留筛选，路径退到 Tooltip/title，使用与 demo 相同的名称行。SessionTabs 的双击/F2 改名绑定被编辑 tab 的 id；切换当前会话不改变提交目标。Chat 改名等待 host；Terminal 名称仍仅更新本地。关闭、overflow、方向键导航和 activity 状态继续可用。
- GitPanel 继续持有 Git status、scope、selected path、刷新 generation 和 diff 请求。InspectorHeader 与 FileRow 只报告用户意图；参数快照、非原子读取说明、冲突 patch 与引用语义保留。
- ToolExecutionCard 统一使用受控 Collapsible/GSAP，成功默认收起，失败自动展开，用户展开状态跨更新保留。参数、图片、输出快照与复制仍来自原 Tool owner。旧 nativeDetails 分支已移除。
- ChatMessage 统一使用作者可访问但视觉隐藏、用户右侧 bubble、助手裸正文与 actions。Content Feature 继续负责 Markdown、流式修补、复制、external-link 与远程图片阻断；不向通用 UI 下沉 Desktop 能力。
- Composer 不再有 transcript 分支。ChatPane 仍持有草稿 revision、附件 token、提交快照清理、send/steer/follow-up/stop host 调用与命令菜单。共享 Composer 管理 IME、局部 pending、键盘提交与呈现；运行中可引导或 Alt+Enter 后续，并独立停止。
- `app/production.css` 是唯一生产样式入口。Feature CSS 只分配常驻 pane、Virtuoso 阅读列、Composer dock 与内容快照空间；不得覆盖统一控件回到旧布局。`renderer/modules`、顶层 ContentView/styles/review 继续退休。

## 隔离验证

### 截图驱动的面板接入（2026-09-22）

2026-10-14 工作台方案阶段 1 更新：Environment 进入 ResizableWorkspace 的正常辅助网格列，横向顺序为项目导航 → 对话 → 环境卡片所在列 → 工具抽屉。列宽 300px、与对话间距 12px，无列级背景或边框；卡片靠顶部、按内容定高，最高占可用列高，长内容在卡片内滚动。已删除原对话顶部布局规则，不使用覆盖层，也不下移对话/Composer。2026-10-14 阶段 2 已将 EnvironmentPopover 替换为 EnvironmentCard、EnvironmentGitDialogs 和 useEnvironmentController；下方阶段 2 契约为当前事实。

`ResizableWorkspaceProps.auxiliary` 只接受一个固定宽度、无独立拖动手柄的辅助列：`id`、`label`、`width`、`gap`、`open`、永久 `toggleRef`、`onVisibilityChange` 和 `content(visible)`。`open` 为调用方意图，`visible` 为 ui 的实际 fitting 结果；自动收起不回写 open。Workspace 的 `useEnvironmentColumn` 持展开意图与开关文案，无第二套尺寸测量。顶部图标以实际可见性设置 aria-expanded，并在空间不足时说明扩大窗口自动恢复；此时再次点击可撤销恢复意图。

fitting 先检查当前主要面板偏好宽度加环境列是否容纳；不足先移除环境，再沿用原主要面板压缩/右侧隐藏/左侧隐藏规则。拖动与方向键、Home/End 共享这一计算，调整上限允许使用环境列释放的空间。测量或拖动导致列收起时，先把列内焦点移到永久开关，再设 inert/aria-hidden；手动 Escape 关闭恢复开关，输入、IME、菜单与 Dialog 的 Escape 不连带关列。显式开关沿用有界 GSAP context；测量与拖动即时布局，系统 reduced-motion 立即就位。

仅实际显示时读取当前 session 的 GitStatus、分支和工作树列表，原读取失效与 Git/会话校验不变。Changes 打开 Git Diff 标签，任务详情打开原 TaskDetailsPanel；Background processes 与 Sources 沿用既有真实投影。会话、草稿、附件、Pi、唯一 PTY、BrowserView 与 Git 的 owner 未调整。

SidePanelHost 是右侧多标签宿主；无标签首页与添加菜单仅提供终端、浏览器和 Git Diff，共用同一入口清单；不展示 Suggested、伪造的快捷键或其他产品能力。浏览器空白页仅提示输入网址。Files 接入只读会话目录浏览和 UTF-8 文本预览；文件 IPC 只接受 session ID + 相对路径，由主进程从 session capability 解析 cwd，路径不允许逃逸、不跟随符号链接，预览限制 256 KB。Browser 使用主进程 `WebContentsView`，为每个视图创建独立的非持久 Session，不注入 preload、禁用 Node，并拒绝权限、下载和新窗口；远程地址仅允许 HTTPS，HTTP 仅允许 loopback 开发服务，renderer 只能通过校验后的窄 IPC 操作导航与视图边界。子视图 bounds 由主进程夹限在宿主窗口内，tab 隐藏/面板卸载时隐藏并销毁。Terminal tab 复用当前 Terminal Session 的唯一 `TerminalPane`/xterm/PTY 订阅，由 `TerminalOutlet` 只调整视口几何在主工作区和右侧 dock 之间显示；不创建第二个终端、不重复 `startSession`，也不绕过 Session 的 Terminal 独占策略。xterm 与 addon 仅在存在终端面板时动态加载，不进入聊天首屏。Side chat 仍是独立 Pi 会话入口。tab 列表按 session/draft 隔离，切 tab 保持已打开 Review 挂载，切会话重置内容投影；全关后回到入口。面板宽度默认 560、最小 280、最大 1000，仍保留 center 360 最小约束与响应式隐藏。

Review 使用连续多文件展示，移除旧 inspector 内卡片。每批 5 个文件、最多 3 并发 fileDiff；刷新/比较范围/会话身份变化清理旧请求结果。集合来自已授权 gitStatus，宿主读取边界不变；结果 Map 不把特殊文件名当对象原型。工作区/暂存区/分支比较是三个真实范围。分支比较以当前 HEAD 相对仓库参照分支的共同祖先为起点，只展示已提交变更；优先使用 origin/HEAD，缺失时仅在 origin 或本地 main/master 候选唯一时推断，并在界面显示实际参照分支。无法确定时明确报错，不把未提交工作树混入分支比较。计数仅按已返回 hunk，截断显式标注，冲突不展示错误双边统计。原文复制、路径引用、未跟踪 Markdown 安全预览保留。UI 库选型与限制见 `docs/research/diff-viewer-selection.md`。

### Tailwind / shadcn 生产迁移（2026-09-22）

用户已进一步授权全界面分阶段实施，计划见 `docs/ui-migration-plan.md`。阶段 1 已接入生产：`ChoiceControls.tsx` 在既有 Select/DropdownMenu/Tabs 接口后使用 Base UI；Collapsible 使用 Base Root/Trigger/Panel，保持 Reveal seam。`tailwind.css` 已由 production.css 和两类预览共同引入，不开启全局 Preflight。UIProvider 提供 Portal 容器，Dialog 覆盖该容器，保留主题及嵌套浮层归属。Base Select 可聚焦禁用项但不能提交。真实键盘/定位回归运行 `node tests/component-preview/choice-controls-check.mjs`。

阶段 2–5 已接入 Dialog、表单、模型 SearchSelect、思考 Select、添加 Menu、统一词段建议与导航 Menu。Dialog 使用 Base focus guard，Tab 边界与 finalFocus 在下一帧完成，测试应等待最终焦点；closeDisabled 阻止所有关闭请求。后台 ChatPane 不渲染 Portal 建议；ResizableWorkspace 的 Escape 忽略 dialog/menu/listbox，避免本地菜单关闭连带关闭检查器。输入建议只替换当前词段，技能候选受 Pi 开头展开协议限制。专项浏览器脚本为 `composer-controls-check.mjs`、`navigation-controls-check.mjs`、`workspace-dialog-check.mjs` 和 `sidebar-menu-check.mjs`。

以下为初始隔离试接入的历史记录，不代表当前仍处于等待确认阶段：

用户已授权引入 Tailwind。Vite 已配置 Tailwind v4 插件，`components.json` 固定 base-nova、Lucide 与 `tw` 前缀。`tailwind.css` 只由独立 `shadcn.html` 预览引入，不进入 production.css；不启用全局 Preflight，局部控件 reset 限定在 `.ui-provider .shadcn-scope`。语义颜色、字体尺寸和圆角映射已有 `--ui-*`，不增加第二套主题权威。

`shadcn-select.tsx`、`shadcn-combobox.tsx`、`shadcn-menu.tsx` 是 shadcn Base Nova 对应组件的裁剪适配（保留 MIT 通知），交互交给 `@base-ui/react`，使用 Tailwind 工具类。仅保留预览使用的组合部件；没有覆盖既有 Select/DropdownMenu，也尚未迁移 `/`、`@`。内容组件要求显式 portal `container`，调用方须提供所属 UIProvider 内、且在原生 Dialog 内的无裁切容器；预览包含原生 Dialog 用例。尚无结构动画，不自行添加另一套动效引擎。

启动 `npm run dev:components` 后访问 `http://127.0.0.1:4182/shadcn.html`，运行 `node tests/component-preview/shadcn-check.mjs`。此阶段的模型/思考/添加操作均为内存示例；没有真实 IPC、模型请求、磁盘扫描或文件选择器调用。生产替换须待用户确认，中文输入法与 `/`、`@` 是后续专项验证，不由本轮预览证明。

本阶段验证：production/preview build、production/preview/tests typecheck、28 项 primitive/module 测试及新浏览器脚本通过，截图在 `/tmp/pua-shadcn-evidence`。全量测试为 2660 passed / 36 failed（9 个文件），包含旧项目 title 查询和 App 结构断言，尚未逐项归因；不可宣称全量回归通过。边界检查通过；`check:protected` 仍对旧冻结清单报告本轮新增 UI 文件和此前 UI 改动，未修改清单以掩盖差异。npm audit 报 Vitest/mocker 两项 moderate，本轮未升级测试框架。

Component Preview 四个浏览器脚本验证共同组件；Workspace Preview 复用完整生产 App/production.css 和 Fake Desktop。运行 `node tests/workspace-demo-check.mjs` 检查生产布局、改名、调宽、面板恢复、消息/工具/输入、主题与 Dialog；`node tests/workspace-dialog-check.mjs` 覆盖 pending 表单焦点。两者只访问 127.0.0.1:4181。Electron 验证使用临时 userData 和本地 mock runtime，只查看空壳与 Settings，不创建会话或访问真实外部能力。


### 工作台正式布局阶段 1 验证（2026-10-14）

- `tests/workspace-layout-check.mjs` 在 Fake Desktop 的正式 App 上覆盖宽窗（1600×1000）、环境优先收起（1300）、主要面板压缩（1000）、右/左收起（800/500）、恢复、鼠标拖动、键盘 Home/End、手动关闭、焦点、长卡片 End 滚动、输入/确认 Dialog Escape、草稿/session 身份、深色与 reduced-motion。`?environment=long` 仅为测试入口的内存压力场景。浏览器无 page/console error、无外部请求。
- `scripts/smoke-workspace-layout.mjs` 使用临时 userData、临时 home 的启动器、显式 mock Pi 与 loopback 网页。验证真实 Electron 的布局/焦点、会话及草稿保留和原生 BrowserView bounds、隐藏/恢复/复用/销毁。不使用用户 Pi 或真实仓库，不执行 Git 写操作；不构成真实 Pi、PTY 或跨平台产品全矩阵认证。
- 仅含阶段 1 的候选树通过 main/renderer/tests/component-preview 类型检查、AST 边界检查、生产构建、上述 web 与桌面 smoke。既有大 bundle 告警保留。完整 dirty 工作树的 tests 类型检查被用户预览数据中两处 `needsAttention` 非 SessionInfo 字段阻断，未修改或夹带这些改动。未新增/扩展单元测试，未运行全量单元测试。
- 预览：`http://127.0.0.1:4183/workspace-preview.html`（保留用户样式与数据）；提交候选预览：`http://127.0.0.1:4184/workspace-preview.html`。截图位于 `.agent-work/workbench-stage1/` 与其 `candidate-web/`，已查看宽窗、窄窗、长卡片及明暗截图。端口由本地进程提供，重启后可用 `npm run dev:workspace -- --port 4183` 和 `PUA_PREVIEW_URL=http://127.0.0.1:4183 node tests/workspace-layout-check.mjs` 复核。


### 工作台环境组件阶段 2 契约（2026-10-14）

`EnvironmentCard` 接收只读展示投影 `EnvironmentCardView` 与受限 `EnvironmentIntent`；`EnvironmentGitDialogs` 接收确认 union `EnvironmentGitView` 与 `EnvironmentGitIntent`。两者没有 Desktop Client 或宿主调用。Workspace `useEnvironmentController` 拥有仓库读取快照、表单草稿、明确目标的确认和 Git 操作 continuation，App 组合它们；旧 EnvironmentPopover 源码/导出已删除。

控制器只在实际显示且 session 存在于 Workspace 投影时读取。身份/显示 scope 对象使 A→B→A、关闭/重开也产生新生命周期；读取 epoch 同时拒绝刷新或 mutation 前的旧读取。每次操作捕获固定 session ID，commit→push 同样不重新指向当前会话。只缓存尚未结束的 operation token/kind，按 session 保持同步防重复锁，完成按 token 删除；新 scope 的错误/表单/确认独立，旧结果不发布，当前仍显示同目标时重新读快照。提交成功后推送失败将确认改为推送状态，不再重复 commit。真实主进程的 cwd、空闲、dirty worktree、路径与 Session 校验保持。

`tests/workspace-environment-check.mjs` 使用隔离 Fake Desktop 与受控结果，覆盖显示门禁、关闭/切会话失效、同目标重开锁、失败与安全重试、确认 Escape 和真实区段投影。`scripts/smoke-workspace-environment.mjs` 使用临时 home/userData 与 mock Pi，在测试启动器延迟真实 IPC 读取结果，验证切会话和关闭目标后的晚到回包；不执行用户 Git 写入。截图位于 `.agent-work/workbench-followup/stage2/`。阶段 2 不构成真实 Pi、PTY、Git 写入或跨平台完整认证。

# PUA 项目组件库

状态：主题 foundation、统一 Icon/Dialog、Workspace/Change Review/Conversation 展示、Desktop-aware Content 与生产样式均已接入生产 App，旧顶层 seam 和 `renderer/modules` 已退休。组件预览继续隔离，静态迁移不代表视觉或运行验收，不能把 preview fixture 当生产数据。2026-09-08 已按用户导出的 codex-theme-v1 配置应用明暗背景、正文、强调色、Diff 与 Skill 色。按用户后续要求，明暗统一使用 Geist / Inter 和 Geist Mono 字体栈，未打包字体时使用相同的本机回退。当前视觉尚待确认。

导出边界：light contrast=40 / opaqueWindows=true，dark contrast=100 / opaqueWindows=false，codeThemeId 均为 catppuccin。未知的 contrast 派生算法和原生窗口透明效果未模拟。用户后续要求优先：Diff 与 highlight 使用低饱和配套色，覆盖原导出 Diff 值；浅色 link 使用实际 ClickUp 任务正文链接测得的 #0b68cb，深色 #79b8ff 与两种 hover 色为本库配套值，不是 ClickUp 实测值。链接下划线保持同色，不再降低透明度。其他基础色保持；字体栈按后续要求统一明暗。提示、引用、Diff 与动效样例均不使用左侧装饰线；Diff 以正负号、文字色和浅底区分。尺寸和行高未由导出提供，沿用现值。

## 分层与封装流程（原则单一事实源）

1. 修改界面前先查 `ui/index.ts`、所属 `renderer/features/*/index.ts` 与 [生产接入与迁移契约](production-integration.md)。先复用或扩展已有接口，确有新职责时再新增；完成必要接口、独立预览与行为测试后，再请求用户确认生产接入。
2. **封装触发**：跨场景复用，或具有统一交互、可访问性、动效状态的控件进入 `ui`；生产工作台领域组合进入对应 `renderer/features/*`。`renderer/modules` 已完全退休；一次性业务分支留在调用方，不为封装制造纯透传、万能组件或预设全部业务的 props。
3. 每个模块按职责拆文件，入口只 re-export；接口类型和行为约定放在实现附近。配色、尺寸、层级和动效通过统一 token，样式始终限定于 UIProvider。
4. 新组件、新状态或接口变动必须同步预览、文档和接口测试。按适用性覆盖 default、hover、focus、disabled、busy、error、键盘、IME、明暗主题、窄窗与 reduced-motion。
5. 结构动效使用 `motion.tsx` 的 GSAP seam；上下文持有量必须有界、可中断、卸载可清理。拖拽实时尺寸不创建逐帧 Tween；不能仅凭活跃 Tween 数宣称无泄漏，长时间操作还需检查 context 历史对象。菜单、改名、拖拽要验证焦点恢复与快速中断。
6. 预览只使用隔离的本地数据，不能调用真实 Pi、Git 或磁盘；生产入口不能引用 fixture。用户确认阶段不自动替换 App。批准后逐模块连接真实数据，保留已有安全、会话、附件与异步行为测试，不整页粘贴预览代码。

## 紧凑桌面密度（所有 UI 与模块的默认约束）

新增组件、修改文字 slot、字重、状态色或对话布局前，必读 [排版与注意力层级](typography-and-hierarchy.md)，按角色选择 token 并验证同屏阅读。

- **先用 token**：尺寸集中在 `tokens.css`；控件 13px、辅助 12px、常规控件 28px，控件圆角 8px、浮层 12px、Composer 20px，邻接间距优先 4/6/8/12px。组件实际消费这些 token，而非在预览给新组件另加缩小特例。长篇 Chat 与 Composer 正文使用 reading token（15px / 1.65），不靠全局小字压缩信息。
- **行 / 浮层 / 容器**：导航、通知与会话优先使用紧凑行及轻分隔；聊天采用稳定阅读列、用户浅底与助手裸正文；状态色用于图标、标签或局部强调，主正文保持中性。Toast、Tooltip、菜单与 Dialog 才使用有限宽度、适度阴影的浮层。容器只为独立内容分组，不给每条消息套大圆角卡片，不无理由将产品控件扩成营销卡片。
- **空间跟随内容**：短通知一行，不强制标题另起一行，操作紧邻正文；显式标题或长错误可展开完整正文。Dialog 按内容自适应，Composer 保留紧凑工具区与可滚动附件条。缩小留白不能裁掉错误、隐藏可操作链接或抹掉焦点环；常规目标至少 24px，必要时通过间距保证可操作性。
- **预览与视觉验收**：小 section、合理列宽和真实项目/会话标签为默认；长标题、多层与长错误放在可展开压力案例。实际查看包含新旧组件的同屏截图（通用页、模块与工作台组合），对比同视口的明暗主题和窄窗，测量 CSS px 高度/圆角并验证键盘详情、焦点及溢出。测试全绿不等于视觉一致；用户视觉确认后才允许生产替换。

## 入口与覆盖

- `ui/index.ts`：UIProvider、Button/IconButton、TextField、Select/DropdownMenu、Tooltip、Tag/StatusBadge、Tabs、Dialog、Collapsible、InlineRename、ResizableWorkspace、Message、ToastHost、Breadcrumbs 与动效工具。
- `tokens.css`、`theme.tsx`：语义颜色、明暗主题、排版、尺寸与外观上下文。`app/production.css` 是唯一生产样式入口，按 cascade 顺序装配 app 与 Feature stylesheets；组件预览保持显式、隔离引入，Workspace Preview 复用生产入口。
- `motion.tsx`：统一结构动效参数；系统 reduced-motion 优先于 normal/slow，off 立即就位。
- `features/*/index.ts`：生产领域展示组件入口。ProjectNav 与 SessionTabs 位于 `features/workspace`，InspectorHeader、FileRow 与 production-only 的 change-review stylesheet 位于 `features/change-review`，ToolExecutionCard、ChatMessage 与 Composer 位于 `features/conversation`；Desktop-aware 的 CopyButton、MarkdownView 与 SourceView 位于 `features/content`。生产与历史迁移约束见 [接入契约](production-integration.md)。
- `tests/component-preview/`：独立展示、内存 Adapter 与浏览器验证；不会进入生产入口。组合交互页是中文工作台场景，模块卡片展示安全正文与受控 Composer。

## 新通用接口

### Message（`Message.tsx`）

通知展示，不是聊天消息。`MessageProps` 接受 `tone: info | success | warning | error`、React `children`、可选 `toneLabel`、`action: { label, onClick, disabled? }`、`onDismiss` / `dismissLabel`。每个 tone 都有统一线性 SVG 图标与可访问文字，不只用颜色区分。`toneLabel` 默认为视觉隐藏的状态语义；需要可见标题时由 children 显式提供，短通知不预留第二行。

`announcement` 默认 off，静态行内内容不自动播报；动态结果可设 polite（status），真正紧急错误才用 assertive（alert）。操作按钮在 live region 之外，避免把整个控件重复播报。调用方决定关闭后数据是否保留。

### ToastHost（`Toast.tsx`）

受控 `items: readonly ToastItem[]` 与 `onDismiss(id)`；item 复用 MessageProps 加稳定唯一 `id` 和 `duration`（毫秒，默认 5000；0 常驻）。调用方收到 dismiss 后删除 id；不要复用同一 id 表达新生命周期。

默认按输入顺序最多显示 3 个，可用 `maxVisible` 调整为正整数；等待项显示时才开始计时。hover 或 focus 都暂停剩余可见时间，二者均离开才恢复。已到期 item 即使调用方尚未移除也只回调一次；更改 duration 会重置该项时长。Host 卸载清理 timer 与 GSAP；重新挂载是新生命周期。

复用 Message 视觉，默认 polite，不创建全局 window 单例、不使用 modal、不抢焦点。GSAP 仅入场，dismiss 立即移除；固定叠放区域限制视窗尺寸并可纵向滚动。系统 reduced-motion 或 off 直接就位。关键不可丢操作应使用 duration=0，而非依赖短时通知。

### Tooltip（`primitives.tsx`）

使用原生 Popover top layer 跨越滚动祖先裁切，同时保留 UIProvider 明暗 token 与所在 Dialog 的 DOM 归属；浮层圆角使用 12px overlay token。显示不抢触发器焦点，hover 与 focus 独立保持，移向浮层有短暂离开宽限；Escape 先关闭 Tooltip，若焦点在全文区则返回触发器。

按视窗可用空间选择上下方向，滚动、resize 与 ResizeObserver 更新位置，关闭或卸载清理监听和待执行工作。超长内容不截断：出现键盘提示时可 Tab 进入全文区，用方向键、PgUp/PgDn 或 End 滚动阅读。依赖宿主原生 Popover 支持；jsdom 仅验证状态和清理，不验证 top layer 绘制。

### Breadcrumbs（`Breadcrumbs.tsx`）

`items: readonly BreadcrumbItem[]`，每项有 `id`、`label` 和互斥的 `onSelect` 或 `href`；最后一项为静态 aria-current=page。外层语义 nav，可配置 `label`。普通 href 支持相对路径、锚点、http(s)，拒绝可执行 scheme、控制字符、反斜线和协议相对地址。

默认单行，末项优先占用剩余空间并截断，所有收起标签可通过 hover 或键盘 focus 的 Tooltip 获取全文（Escape 关闭）。超过三层时保留首尾，中间层通过可键盘操作的原生 disclosure 展示完整链接/操作，Escape 收起并恢复焦点；不以 overflow:hidden 吞掉层级。调用方只传有意义的项目/会话标签，不默认塞完整路径；路径详情通过用户主动操作展示。链接导航的业务去向由调用方审核。

## 既有行为保持

- Collapsible 的 title 支持非交互 ReactNode，label 可提供完整按钮可访问名称；原字符串调用保持兼容。ToolExecutionCard 用它将图标、摘要和状态合并为一个详情入口，复用现有展开/收起与 reduced-motion 行为。

- `ui/Icon.tsx` 统一映射 lucide-react 按需导入图标：24px 网格、16px 显示、1.75 线宽。通知、状态和任务清单复用同一来源；不再手画路径。免费使用许可为 ISC，部分 Feather 来源图标为 MIT；许可证随 npm 包提供，发布时保留其通知，见 https://lucide.dev/license 。生产与预览现统一使用该来源，旧 `renderer/Icon.tsx` 已删除。
- 图标选型参考实际 ClickUp 页面的齿轮、折角文档与循环箭头；采用同一免费 Lucide 家族的 Settings、File、RotateCw，warning 使用 CircleAlert。它们是风格匹配，不是 ClickUp 专有 SVG 的逐路径复制。
- 语义颜色：链接使用明显蓝色及 hover 色，成功/新增绿色、失败/删除红色、警告琥珀色、高亮淡紫色；代码关键字、字符串、数字各自使用 token。中性底色和主操作保持原层级。
- Foundations 新增图标目录与完整文档样例，组合页复用同一静态样例；包含 mark、kbd、任务清单、代码着色、ins/del、状态表、术语、折叠内容、图注和脚注。代码着色为本地 React span，不是新增 Markdown 解析器。

- Dialog 是生产与预览唯一的原生 modal 实现，Tab 循环、Escape 请求关闭、恢复 opener；可配置 closeLabel。需要输入初始焦点的调用方传入 `initialFocusRef`（不用 React `autoFocus`），Dialog 在 `showModal()` 后聚焦；Tab 循环排除隐藏、禁用和负 tabindex 控件，每个具名 radio 组只保留已选项（无选项时取首项）。生产 Fake Desktop 回归运行 `node tests/workspace-dialog-check.mjs`（需 4181 Workspace Preview）。`closeOnBackdrop={false}` 供原本不响应 backdrop 的调用方保留关闭语义，`closeDisabled` 让异步提交期间的关闭按钮与业务锁一致。确认、危险操作、异步失败的状态由调用方控制，示例在 `CompletionExamples.tsx / DialogExamples`，没有另造一套 Dialog。
- InlineRename 支持双击/F2，labels 可配置输入提示、保存/取消和失败文案；SessionTabs 按 id 恢复焦点，忙碌编辑器可作为焦点目标。未增加改名菜单入口。
- ResizableWorkspace 窄窗先隐藏右侧再隐藏左侧，保存宽度恢复；separator 即将移除前把焦点移到永久 toggle。原有 GSAP 有界 context 与中途反转策略保持。

## 验证

脚本以根 `package.json` 为准。接口测试位于 `tests/component-*.test.tsx`；预览独立类型检查使用 `npx tsc -p tests/component-preview/tsconfig.json --noEmit`。运行 typecheck、完整 test、build 后，使用已安装 Chrome 执行 `node tests/component-preview/browser-check.mjs`（预览服务端口见 vite.config.ts）。

密度与明暗/窄窗截图验证使用 `node tests/component-preview/density-check.mjs`；Tooltip 组合页长标题、实际祖先裁切、全文键盘滚动与 Dialog 层级使用 `node tests/component-preview/tooltip-check.mjs`，证据写到脚本列出的临时目录。排版、三级文本对比度、真实系统字体、长回答滚动与 Composer 不遮挡验证使用 `node tests/component-preview/typography-check.mjs`。浏览器验证覆盖真实菜单/Dialog 焦点、通知动画/暂停/卸载/reduced-motion、受控草稿与附件，以及有界 GSAP、改名 id 焦点、拖拽和窄窗恢复。jsdom 合成 IME 事件不是系统真实输入法认证；本地 Adapter 不是 Pi、IPC 或真实附件实测，单一 Chrome 检查也不是完整可访问性或跨平台认证。

# PUA 桌面架构（0.3）

状态：已实现的原生对话优先架构。产品行为见 [README](../README.md)，技术取舍与协议细节见 [原生对话技术设计](native-chat-design.md)。

## 选型

**Electron + React/TypeScript + Pi RPC + 显式 PTY 兼容入口**。

原生对话是默认产品路径。PUA 不解析 ANSI 推断业务状态，而是消费 Pi 的消息、工具、队列、重试、压缩和 extension UI 事件。用户本机 Pi 仍拥有模型、凭据、工具、技能、扩展和会话文件。

PTY/xterm 不再是主界面，但仍是一个真实 adapter：RPC 明确无法承载任意 `ctx.ui.custom()`、自定义 editor/header/footer/theme 和 TUI renderer，登录、设置及首期未原生化的历史/树操作也继续从兼容终端进入。

当前结构迁移已退休 `src/main`：main composition 位于 `src/app/main`，sandbox preload 唯一入口位于 `src/app/preload/desktop-api.cts`，两个 utility 入口位于 `src/app/workers/{pi-rpc,pty}.worker.ts`；Electron utility 资源 Adapter、Pi RPC helper、PTY 流控和进程树分别位于 `src/platform/electron/utility`、`src/platform/pi/rpc`、`src/platform/pty` 与 `src/platform/process`。`Terminal` 窄 Interface 位于 `src/modules/terminal/index.ts`。跨进程 DTO、事件、验证器与诊断 metadata codec 全部位于 `src/shared/ipc`，`src/shared` 顶层源码路径已退休；Change Review 的 renderer scope 投影归 `renderer/features/change-review/scope.ts`。renderer composition root 现为 `src/renderer/app/App.tsx`，旧顶层 `src/renderer/App.tsx` 已删除且无兼容转发。这些批次只移动职责与修正 import/URL/config，不改变 Session/Conversation 状态所有权或 IPC 契约；按用户要求未运行自动测试、构建、typecheck、smoke 或应用，不能据此声称运行验证通过。

## 非 UI 结构迁移 checkpoint

用户授权的非 UI 源码结构迁移现已完成：main、preload、utility worker 与 renderer 入口可按进程定位；Electron、Pi RPC、PTY、Git、filesystem 与 process 实现位于 `platform` Adapter；Session、Conversation、Change Review、Preferences、Terminal 通过各自 `modules/*/index.ts` 暴露；renderer 的 Workspace、Sessions、Conversation、Terminal、Change Review、Preferences 已按 Feature 归位；跨进程契约集中在 `shared/ipc`。旧入口和兼容转发已删除，边界脚本覆盖已退休路径、core → platform、跨 Feature 深层引用及 main use case → 具体 process Adapter 等主要漂移。

`SessionProcessAdapter` 有意保留为单个物理资源 registry 对多个窄 Port 的实现：只有 `app/main/composition.ts` 构造具体类，create 与 attachment 用例只依赖各自 Port。拆出多个 class 会触及 pending、cleanup、附件、activity 与进程生命周期，或引入共享 registry/浅代理，因此不属于本 checkpoint 的安全结构迁移。`app/main/{create-session,chat-attachments}.ts` 同样保留为跨 Session、Conversation 与资源边界的 composition-edge 编排；不为目录对称增加空 Workspace backend、Terminal 转发 application class 或单实现空层。

该 checkpoint 只基于源码 read/search/diff 静态审查。迁移后的 TypeScript 模块解析、构建产物路径、Electron/Pi/PTY 生命周期和真实桌面行为均未执行验证。生产 UI 第一阶段接入 `UIProvider`、semantic tokens 与单一主题解析，并建立显式 production stylesheet；第二阶段将生产 Icon 与 Dialog 收敛到 `renderer/ui`，删除旧顶层 `Icon.tsx` / `Modal.tsx`，Extension UI 也复用同一 Dialog。布局、Feature 组件、`ContentView` 和旧样式仍待后续分阶段收敛。第一阶段提交 `35c7589` 后按用户指令执行了 `npm run dev`：其内含 production build 并成功启动 Electron，只证明该提交可构建、可启动；未执行测试、独立 typecheck、smoke、浏览器检查或视觉/行为验收。第三阶段将 ProjectNav 与 SessionTabs 从 `renderer/modules` 迁入 `renderer/features/workspace`，生产与隔离预览共用同一 Feature 组件；Workspace hook 继续独占选择，ProjectNav 只持筛选 query，SessionTabs 只持 overflow 与 InlineRename 交互状态。生产关闭、overflow、键盘导航和独立 Rename Dialog owner 保持，预览的 rename/add 仅由本地 callback 启用。第四阶段将 InspectorHeader 与 FileRow 迁入 `renderer/features/change-review` 并接入 GitPanel；Git status/scope/selected path、刷新 generation 与 diff 请求仍由 GitPanel 持有，组件只转发关闭、刷新或选择 callback。第五阶段将 ToolExecutionCard 迁入 `renderer/features/conversation` 并接入生产 ToolCard；原生 details/summary、失败自动展开、展开状态、tool arguments/images/output 与 CopyButton/SourceView 行为保留，tool activity 和消息 block owner 不变。第二至第五阶段均只做静态审查，未运行上述命令或重启应用。其余范围包括 `renderer/modules` 剩余组件按职责迁入 Feature/UI、formatter、完整 lint 和跨平台 release matrix；因此这不是全量目标架构完成、行为验收或发布完成。

## 进程与依赖方向

```text
React workspace
  ├─ ChatPane: PUA ChatMessage / ToolActivity / ExtensionUI
  ├─ GitPanel
  └─ TerminalPane (explicit compatibility only)
          │ narrow preload intent interface
          ▼
Electron main / typed composition
  ├─ chat adapter ── utilityProcess rpc-host ── child_process ── user pi --mode rpc
  └─ terminal adapter ── utilityProcess pty-host ── node-pty ── user pi TUI
```

`src/shared/ipc/conversation.ts` 是 renderer 唯一需要理解的对话 wire interface。Pi 原始 RPC 对象、JSONL framing、请求 id、结构归一化和协议错误留在 `src/app/workers/pi-rpc.worker.ts` 与 `src/platform/pi/rpc` Adapter；delta/tool/final/历史关联现由 worker 的 Conversation stream core 独占。renderer 不能发送任意 RPC command。

## Desktop IPC 首批重构（有限落地）

本节及后续有限批次保留当时实施路径作为历史记录；其中出现的 `src/main/*` 当前均已由文首所列 app/platform/module 路径替代，不再是运行入口。

首批只建立 IPC 单一来源与可执行验证基线；后续 Session 有限提取见下节，Conversation send/attachment 子阶段见后文；本段为首批历史范围；worker typed 协议的后续有限落地见下文，目录树迁移未做。首批当时冻结 renderer；当前用户已条件解冻生产 App/Workspace 业务整理，原 `ui`、`modules`、44 项组件/demo 集合与视觉参考依赖闭包继续原位原字节保护。正式 UI 未替换，目标架构的后续 UI 收敛仍保留。

- `src/shared/ipc/desktop-api.ts` 是 DesktopAPI 和桌面 DTO 的唯一声明，复用同目录 `conversation.ts` / `change-review.ts` DTO。旧 `src/shared/contracts.ts` 及其它 shared 顶层契约路径已删除，生产与测试调用方直接引用 canonical seam；边界门禁禁止重建或从生产源码导入旧路径。
- `channels.ts` 按现有 invoke/send/event 分类；`schemas.ts` 用 DesktopAPI 参数 tuple 穷尽所有入站方法。`platform/electron/ipc/registrar.ts` 统一执行当前窗口身份、主 frame、精确页面 URL 校验，再解析参数，再调用原 Implementation。invoke 保持原成功值/异常，send 保持记录并丢弃失败，不新增结果 envelope。
- Preferences、create 纯形状、终端尺寸、diff scope 校验被原 main-side Implementation 复用；extension response 继续重建既有白名单。会话准入、关闭 race、项目真实路径、Git 成员资格、附件 token 与文件路径映射、recentProjects 所有权仍在 main；未向 ChatAttachment 新增路径或任意 Pi command。
- seam 额外拒绝参数数量错误、错误枚举/尺寸、稀疏附件/设置数组。聊天缺省 text、PTY 控制字节（含 NUL）、相对/`~` 项目路径语义保留。既有限额见 schema；没有为剪贴板、终端粘贴、ID/路径或 Preferences CLI 参数擅加长度上限，剩余限额策略与结构化错误仍待单独授权。
- preload 仍逐方法列举白名单。Vite 将 `.cts` 和共享常量打包为单个 CJS，只 external Electron，保留 sandbox/contextIsolation/禁 Node；不能用本地模块 `require` 或关闭 sandbox 绕过打包。

### 验证入口与尚未完成项

`npm run verify` 执行冻结文件集合/hash 检查、TypeScript AST import/channel 门禁、main/renderer 及 tests/fixtures 的 TS/TSX 类型检查、全单测/组件测试、一次生产构建、隔离 Electron IPC smoke 和生命周期 smoke；`package` / `dist` 依赖它。`.mjs` smoke/fixture 不在 `tsconfig.tests.json` 类型检查范围内，由可执行回归与 smoke 验证。脚本使用现有 TypeScript 和 Node 原生类型擦除（Node 22.18+ / 24），没有新增依赖。

import 门禁只检查当前生产树：shared/renderer 禁 Node、Electron、node-pty 与平台 Implementation 引用，shared 禁 React/renderer 引用，`src/shared` 顶层源码路径禁止重建，生产禁 fixture import，main/preload 禁内联 desktop channel；同时识别静态 import/re-export、类型 import、require 和字面量动态 import。它不是完整 lint、通用依赖治理或 formatter。`check:protected` 的 manifest 对应本批保护点 `a4fb717`，未来 UI 修改须先获得新的范围授权，而非将本批冻结当成永久架构目标。

IPC smoke 使用临时 userData 和显式本地 fixture runtime，仅解析 runtime、不启动 Pi；验证真实 sandbox preload、窄方法、异窗口 sender 拒绝、非法请求和 event 取消订阅，不使用系统剪贴板、外链或真实 Git 仓库。`test:lifecycle` 可单独构建并运行原五场景；`verify` 在已有构建后直接调用同一个生命周期脚本，避免重复 build 或 verify/build 递归。生命周期脚本目前仅验证 macOS，其他平台明确非零退出并阻塞 package/dist，不静默跳过；跨平台发布仍未验收。门禁 wiring 测试在临时目录保留真实 npm 调用链、替换叶子步骤与打包器，检查失败传播，不实际打包。

生命周期 fixture 必须收到普通与 detached 两个后代的 readiness 确认后，才回复不兼容 handshake。旧 fixture 先回复、产品随即正常清理，后代可能尚未登记 ready，导致 `Pi and both descendant fixtures started` 少于 3；该竞态在 `a4fb717` 也可复现，不是本批 IPC 新增的产品清理回归。spawn 日志独立于 ready 日志，异常清理也能识别迟缓后代；每场景限制启动、运行与清理时长，保持三进程已启动及全部退出断言，且先验证产品清理再兜底回收。`test:desktop` 会触及系统剪贴板，`test:pi` 会定位真实用户 Pi，二者不在本批无副作用默认门禁内。

首批当时不是阶段 0 或 Spec P1 全完成：formatter、完整 lint、完整产品 smoke、preview-only export 清理、UI 迁移、跨平台发布矩阵尚未落地；当时尚欠的 Conversation 提取、结构化 IPC 结果与旧类型兼容入口已由后续有限批次落地，未设上限的参数长度策略及完整桌面验收仍待后续。UI 统一由用户冻结后置。此前单次 IPC timeout 未建立根因，本轮通过不构成其已修复的证据。现有组件预览浏览器检查仍是独立验收，冻结前已经失败的项必须保留并报告；不能通过修改冻结文件或减少脚本覆盖使本批变绿。构建仍有既有大 chunk 告警。

## DesktopResult / Renderer client（有限 vertical）

当前链路为应用 `DesktopAPI → renderer/app/desktop-client → DesktopBridge → sandbox preload → registrar → 原 application`。21 invoke 全面结构化成功/失败；3 send 保持同步 submission-only；1 event 每订阅精确取消、inactive/late guard。所有生产 global bridge 读取收归 client，App/ChatPane/TerminalPane/GitPanel/ContentView/features 原业务 owner、keys/effect deps/continuation 与视觉保持。wire guard 只查必要外层，不建递归 transcript schema。

权威 Interface、错误分类/可见文本兼容差异、Fake/preview/smoke 迁移与 gate 的真实边界见 [Desktop client 契约](desktop-client-contract.md)。纯 Fake/noEmit/AST/hash/隔离 build 不代表 Electron/Pi/桌面或视觉验收；DesktopResult/client 已提交为 `e7b5fa8`；App composition 收尾见下节，Prefs alias、bounds/lint/UI 与发布门禁仍后置。


## App composition：窗口工作流归位（有限代码收尾）

本包基于 clean `e7b5fa8861f50c4c0652d7a39af2760d2f0188d7`，仅整理 renderer presentation，不改变业务规则。当前 `renderer/app/App.tsx` 保留 JSX、ID 绑定、窗口 capture 路由与 inspector 纯 layout；不直接调用 client、持草稿/handle registry 或实现 Promise continuation。旧 `renderer/App.tsx` 已在后续纯路径批次删除，不留兼容入口；`app/useWorkspaceComposition` 只连接命名 owner，无自身 state/effect/ref 或全字段 props bag。下文早期 renderer 各 slice 的“App 仍持有”描述是该批历史，不是当前所有权。

| 当前唯一 owner | Interface 与不取得的职责 |
| --- | --- |
| `app/useDesktopPresentation` | bootstrap snapshot、全局 error、Settings open/publish/close、refresh；调用原 useTheme，不取得 main Preferences current/recents |
| `features/workspace/useWorkspace` | 原 sessions/selection/events/close；无第二 Session 生命周期 owner |
| `features/sessions/useSessionLaunchController` / `useNewSessionLaunch` | launch context/defaults/open、host create 成功 continuation；挂载局部表单仍持 inspection/trust |
| `features/sessions/useSessionPresentation` / `RenameDialog` | 提交捕获身份、改标题、打开目录、原 dialog；Terminal 名称仍仅窗口标签 |
| `features/workspace/useSessionInput` | 按 ID 草稿文本、活 handle registry、search 呈现、command/reference/terminal picker 输入路由；不持 Chat revision/附件 token/发送锁或 xterm 实例 |
| 原 palette、Settings draft、ChatPane、TerminalPane、GitPanel | 各自原状态与 effect 不迁；后端 Session/Conversation/Preferences 与 client seam 完全不动 |

### 调用图与时序 Interface

- `create → await host → Workspace add/select → launch close/reset → input.hideSearch → desktopPresentation.refresh` 在同一 continuation。两个 outlet 同步、不 await；关闭不取消旧 create，完成顺序仍决定追加/选择，旧完成仍可关闭新 dialog。refresh 非 async 包装：异步 reject 报全局错，同步 throw 会拒绝 create、进入已经卸载的原 form catch；不回滚成功 session。
- `rename → 捕获提交 render 的 active → Chat await host(旧 ID) → 同 ID setTitle → close`。打开时不固定 ID；Terminal 不请求 host；reject 留原 dialog error。不加锁、generation 或取消。
- `close → await host truthy → 最新 Workspace remove → input.forgetDraft(id)`；回调闭包延后执行，声明 input 前不读取。无新增 effect/ref 桥；false/reject 不删除，不给 close fallback 添加 hide search。
- command 同步 snapshot append newline 或 live registry paste，正常返回才 dismiss palette；throw 不 reset。Git Chat reference 不 dismiss，立即 focus 当前 active textarea；Terminal 走 command insert。引用后窄窗只关闭 inspector，不抢 toggle 焦点。
- terminal picker 保留发起 render 的 insert/目标 ID，完成才查当前 registry；不会改向最新 active，也不会保存已 disposed handle。原 snapshot append、关闭后旧 callback 可写 presentation 的局限保留，未新增失效政策。
- search hide/toggle 不清 text/found、不清 decorations、不 focus；编辑才重置 found。关闭按钮仍 clear → hide → focus。所有 pane 按 session.id 常驻；Terminal 的 callbacks.current dereference、onReady/unregister 与原 exit callback 路径不变，Chat `[state.commands]` effect 不增 deps。
- effect 相对顺序仍为原 useTheme 两个 effect → bootstrap `[]` → Workspace subscription `[]` → App capture `[boot?.platform, active?.kind]` → inspector Escape `[reviewOpen, active?.id]` → media `[]`。capture 保留原位置；palette toggle、input toggleSearch 仅 setter 稳定，listener 不依赖 owner 对象或 active ID。其他 action 按 render 捕获身份，不统一 latest-ref。
- Settings 保存仍 publish 原引用 → runtimeError/close；旧 save 成功能关闭重开的 dialog，旧 runtimeError 能发布 theme 但不污染新 draft error。bootstrap 依完成顺序发布、client 每请求动态绑定；原同步 throw、callback throw 与 reject 的差异不统一修复。

### 验证范围与后置项

新增 `tests/App-composition.test.tsx` 先在旧 App 运行，再以同字节断言运行提取后 App；原 feature/vertical Fake 测试保留，不 mock 新 controller。覆盖 effect 注册/清理与 deps、反序 refresh、rename 提交前/后身份、两个 terminal registry 与旧 picker 卸载、search/fallback、Git 两分支/窄窗焦点、草稿 revision 编辑改回及附件身份、sync throw/reject 与动态 client。既有 old-save 三分支、close latest、create order 与真实 client/registrar/source-preload/Virtuoso 测试继续保留。`App-composition-structure.test.ts` 是 source AST 断言，单独计为静态证据，不是行为验收。新 App tests 的 Virtuoso 是真实实现；旧 workspace/renderer tests 仍 mock 列表，client vertical 使用官方 layout context，均不是布局/系统 IME 证明。

候选以 HEAD archive + 明确 allowlist 构造，完整 before 包含 ignored 项目 docs/素材、模式/SHA、current dist 与三个源闭包。仅执行明确 Fake/jsdom 白名单、三个 noEmit、两 preview 类型检查、既有 AST/protected、隔离生产/preload/两 preview 纯构建及 source/emitted URL/require 静态核验；定向 `/tmp` 变异只证明断言敏感性，故意红不算产品失败。可恢复源码、日志、候选身份与完整增量见 `/tmp/pua-app-composition-before`、`/tmp/pua-app-composition.logs`、`/tmp/pua-app-composition-candidate` 和 `/tmp/pua-app-composition.diff`。本包未 stage/commit；独立 review 后由 Main 决定提交。

原 ui/modules、44 保护集合、27 节点 demo 字节及边闭包、当前 dist 均保留；workspace-preview 入口/fixture/config 不改，仅随真实 App 增加 owner 的传递依赖。保护文档中旧 ContentView 直接依赖 window.desktop 的表述已落后于 client seam，本包不改保护文档。未操作用户运行旧 dist 的应用，未执行输出、Electron/Pi/browser/真实 fsGit fixture、smoke/lifecycle/IPC 集成、verify/dev/package/dist 或全量 npm test。jsdom 不代表真实 focus/IME/PTY/桌面验收。这里只达成 App 必要工作流归属，不要求所有局部 display 无 state；不是阶段 4 全完成、完整目标架构、原助手缺失 P0 修复、Preferences alias 修复或新桌面/发布验收。既有大 chunk 告警及真实验收后置。

## Renderer 领域 Presentation 路径归位（阶段 4 仍未完成）

Workspace、Conversation、Terminal 与 Change Review 的生产展示入口现分别位于 `renderer/features/{workspace,conversation,terminal,change-review}/index.ts`。原顶层 `WorkspaceNavigation.tsx`、`ChatPane.tsx`、`chat-state.ts`、renderer diagnostics、`TerminalPane.tsx`、`terminal-keys.ts`、`GitPanel.tsx` 与 `diff-lines.ts` 已删除，不留转发；App 与跨 Feature 调用均经对应 index。原 `terminal-keys.ts` 仅按职责拆为 Terminal 的 modified Enter 协议适配和 Workspace 的 reference path 文本格式化，函数行为不变。

早期结构批次只移动路径、调整 import/export、静态边界门禁和既有测试引用；当时 Chat reducer/revision/附件、xterm 生命周期、Git 检查区局部状态、Workspace 草稿/handle registry、`session.id` 常驻 key、DOM/CSS 与 Desktop Client 均不变。后续 UI 阶段仍不改这些状态与 Desktop Client owner，但会按阶段替换对应展示 DOM/CSS。顶层 `ContentView.tsx` 仍是 Conversation 与 Change Review 共用的临时 presentation seam；旧 Feature 样式保持原位，待后续正式 UI 系统收敛，不把它们误归某个 Feature。生产主题解析、tokens、Icon 与 Dialog 已归入 `renderer/ui`，旧顶层 `theme.ts`、`Icon.tsx` 和 `Modal.tsx` 已删除；ProjectNav 与 SessionTabs 已从 `renderer/modules` 迁入 Workspace Feature，InspectorHeader 与 FileRow 已迁入 Change Review Feature 并接入 GitPanel，ToolExecutionCard 已迁入 Conversation Feature 并接入 ToolCard，相关旧模块文件和原合并式 `WorkspaceNavigation.tsx` 已删除；Terminal 的静态 xterm palette 位于 Terminal Feature，只投影 resolved theme，不取得主题偏好所有权。生产 Dialog 调用方显式关闭 backdrop dismissal，以保留旧关闭语义；Extension UI 的 pending/answer owner 仍在 Conversation Feature。

按用户要求未运行自动测试、build、typecheck、smoke、Electron、Pi、浏览器或产物；只做源码 read/search、diff 与 `git diff --check`。因此相对 import、barrel export、真实桌面交互和视觉仍未执行验证，本批不是目标架构阶段 4 或全量架构完成。

后续 composition-root 纯路径批次又将 `renderer/App.tsx` 迁至 `renderer/app/App.tsx`，生产 `main.tsx`、直接测试/预览引用及静态 source lookup 全部直连新路径，旧路径由边界门禁禁止重建。App 函数体、hook/effect 顺序、JSX、key、DOM/CSS 与状态所有权未改；`tests/workspace-preview.tsx` 仅更新 App import。该批同样未运行任何自动验证或应用，模块解析与运行行为仍未执行确认。

## Session 核心有限提取（阶段 2 代码与纯测试）

实际调用路径：`app/main/bootstrap.ts → app/main/composition.ts` 装配单个 `SessionCoordinator`、`ConversationApplication` 与 `SessionProcessAdapter`；main 直接消费收窄的真实 Session/Conversation/Terminal 能力。`modules/sessions/index.ts → SessionCoordinator / SessionOwnershipPolicy → SessionProcessPort ← platform/electron/utility/session-process-adapter.ts → app/workers/{pi-rpc,pty}.worker.ts`。IPC 方法、DTO、错误传递方式与 renderer 均不迁移。

后续 Port 去具体化批次使 `app/main/create-session.ts` 只依赖本地 `SessionResourceRegistrationPort`，`app/main/chat-attachments.ts` 只依赖本地 `ChatAttachmentStagingPort`；`app/main/composition.ts` 是生产源码中唯一引用并构造具体 `SessionProcessAdapter` 的位置，并以 Session、Conversation、Terminal 与两个边缘 Port 的交集描述同一个物理资源 owner。没有拆分 Adapter、增加 registry、转发层或运行语句；静态边界门禁禁止两个 use case 导入 platform，并禁止其它生产源码直接依赖具体 Adapter。

| 状态/规则 | 当前唯一所有者 |
|---|---|
| 同步预留、Chat 并行/恢复互斥、Terminal 全局独占 | `SessionOwnershipPolicy` + coordinator registry |
| reserved/starting/running/closing/cleanup-failed/exited、shutdown 准入与释放 | `SessionCoordinator`；不引 Electron、Node、shared DTO 或 activity |
| utility handle、PID、退出确认、唯一树清理任务、pending/watchdog、附件物理资源 | `SessionProcessAdapter`；只读查询 core 许可，不另存 processStatus |
| activity | worker Conversation runtime 决策，main adapter 只持事件 projection；与 Session 生命周期仅在纯 `app/main/session-mapper.ts` 映射 `SessionInfo` 时组合 |
| cwd / UUID 准备、创建编排、运行参数登记、中文错误/DTO | `platform/filesystem/session-preparation.ts` / `app/main/composition.ts`、`app/main/create-session.ts`、process adapter、`app/main/session-mapper.ts`（各自专职） |

创建先复用 schema/intent 校验，仍以 `expandHome + resolve + stat` 准备目录（不是 realpath 身份）；异步检查后重新进入 coordinator 的同步 `create`。最终准入、预留与 adapter 材料登记间无 await/外部通知；登记失败走清理补偿。core 返回稳定拒绝 code，中文文案只在边缘映射。core `get/list` 返回 detached snapshot；纯 mapper 新建 DTO，不暴露内部 handle/Map。

close 与 unexpected host exit 均先同步锁定；ready/title 的迟到事件不能复活会话。pending 在 transport 结束/close 时立即终结，postMessage 同步失败清除 slot/timer。只有实际 host exit **且**登记子树清理成功，core 才发布 exit/release；失败结果 sticky，仍占用且不可 start。2 秒优雅关闭后沿用树清理/kill 升级；kill 后 2 秒仍未确认 host exit 则明确失败，不假报退出。重复 close/exit 共用工作，外部 observer 抛错不决定资源清理。附件预算/token/串行与确认消费已在后续 Conversation 子阶段迁出；adapter 异步读取各等待点仍检查身份/许可，关闭后不重新登记。

worker 未移动。composition 注入由 `import.meta.url` 转换的绝对 worker 文件路径；纯 build 后静态检查 `dist/main/{rpc-host,pty-host}.js`、core/adapter 输出及 sandbox `preload.cjs` 仅 require Electron，不执行产物。

本批实际验证：三个 tsconfig 的 `tsc --noEmit`、显式 Vitest 文件白名单（ownership/coordinator/session-process-adapter/sessions/import-boundaries/protected-files/rpc-host/pty-host/ipc-adapter/ipc-contract/lifecycle-deadline）、AST/44 文件集合与 hash 检查、纯 tsc/Vite build。应用/桌面/Electron/浏览器/真实 Pi/child fixture 均未启动；`verify`、smoke、发布 gate 刻意未运行。**阶段 2 代码/纯测试完成，桌面生命周期待用户人工确认**，不是阶段 2 完整验收或其它阶段完成。UI 与组件预览冻结保持；既有大 chunk 告警保留。

本轮已满足旧 facade 的局部删除条件：`main/sessions.ts` 已删除，创建/附件用例与纯 mapper 分离，生产与测试均无旧入口 import，无第二 facade。当前 raw request/附件物理资源仍与 process adapter 组合；业务登记与发送通过下述 Conversation Interface。后续 Port 去具体化仅以源码 read/search、diff 与 `git diff --check` 检查，按用户要求未运行自动测试、build、typecheck、smoke 或应用，因此组合交集与 Fake 的编译兼容性尚未执行验证。POSIX 已知 PID 登记/daemonize 窗口不扩大保证；Windows taskkill 忽略错误的既有实现不等同 POSIX 清理确认，非 macOS 发布 gate 仍阻塞。

## Conversation send + attachment 子阶段（阶段 3 未完成）

调用路径：`platform/electron/ipc/register-desktop-ipc.ts / app/main/chat-attachments.ts → modules/conversation/index.ts → ConversationApplication → ConversationRuntimePort / AttachmentResourcesPort ← SessionProcessAdapter`。core 不引用 shared DTO、React、Node、Electron 或 Pi 协议。main 的 `conversation-mapper.ts` 映射输入、闭合扩展回答与稳定失败 code；附件展示 mapper 保留既有 `ChatAttachment.path`，不新增 IPC 能力。

| 本子阶段状态/规则 | 唯一所有者 |
|---|---|
| 会话内有效 token、撤销/确认消费、附件数量/图片预算 | Conversation domain/application |
| 每会话登记串行、单发送占用、跨 await 的操作身份 | Conversation application；不是 Session 生命周期副本 |
| opaque source → path、句柄、图片编码/预览与 payload 索引 | process adapter；索引只物化已授权 token，不另持预算或发送锁 |
| Session 准入、host/tree cleanup 与释放 | 原 SessionCoordinator，不变 |
| activity、queue/Extension waiting | 后续 worker runtime 子阶段提取，见下节；main application 不持副本 |
| stream/tool | 后续 worker stream 子阶段已提取，见下节；main 不持 transcript 副本 |

附件先 stat，core 同步预算准入后才分配图片 Buffer/读取；每个 await 后检查原资源身份与许可，finally 关闭句柄。全批成功才登记 token；批次失败丢弃本批 payload/source，不动已登记附件。send 在首次 await 前选择 token、占用发送并交 adapter 构造原 prompt/streamingBehavior；确认成功只消费提交时的 token，期间新登记保留，明确失败可重试。关闭/transport-ended 在原同步 invalidate 路径失效 Conversation 并释放物理索引，late read/ack 不重建登记；这不发布 Session exit，也不提前释放 host/tree 所有权。

已删除 adapter 原 `attachmentWork` / `sending` / 业务附件登记与预算实现，`attachment-policy.ts` 只留路径/MIME 分类。typed runtime 显式 send/stop/respond/rename。该 send 子阶段当时的 raw request ID、utility envelope 与任意 command helper 均 private 于 adapter；当前 wire/helper 的闭合状态见 [Worker 小节](#worker-typed-wire--terminal-interface阶段-3-仍未完成)。该 send 子阶段未提取 stop；后续下节 runtime application 接管 clear → 恢复 → abort 深规则。

本子阶段只以纯 Fake Conversation/adapter/worker 时序测试、静态类型/AST/冻结 SHA 与纯 build 验证；没有启动应用、Electron、浏览器、真实 Pi 或外部进程 fixture。streaming/tool/历史关联已在后续 stream 子阶段提取；本子阶段当时尚欠的 typed worker envelope 后续状态见 [Worker 小节](#worker-typed-wire--terminal-interface阶段-3-仍未完成)。完整阶段 3 与桌面原生对话验收仍未完成，后者不能由源码或纯测试替代。原浏览器基线失败项未运行、不声称变绿。

本轮已删除 `Sessions`，当前装配与替代回归见下述 [composition 状态](#main-compositionfacade-已删除阶段-3-桌面待用户)；Terminal 仍无空转发层。

## Conversation runtime 子阶段：stop/activity/waiting（阶段 3 未完成）

调用路径：main `ConversationApplication` 的 typed stop/respond → 原 `SessionProcessAdapter` utility envelope → `rpc-host` composition 的**单个** `ConversationRuntimeApplication`。main application 仍只拥有附件/发送操作身份；worker runtime 不持 Session registry、lifecycle、附件 source/payload/token 或预算。core 的封闭 semantic input、operations/clock Ports 与 notification Interface 不引用 Node、Pi、Electron、React 或 shared wire。`conversation-runtime-mapper.ts` 是未知 Pi 字段与现有 DTO/错误文案的映射位置。

| 本 slice 规则 | 唯一 owner / Adapter 责任 |
|---|---|
| stop clear 确认 → 同步 recovery 正常返回 → abort；无锁、无合并、无自动重放 | worker runtime；host closure 仅捕获每次原 renderer requestId，完成响应仍无草稿 |
| underlying activity、observed handshake 标记、queue/status/widget | worker runtime；host 不留完整状态缓存，main/renderer 只投影 |
| waiting 覆盖最新 underlying；dialog 成员、32 上限、重复/过期/匹配、成功写入后退休 | worker runtime；clock Adapter 提供 now/at/cancel，raw timeout/白名单归一化留 edge |
| 普通 5 分钟/握手 15 秒 remaining-budget 暂停恢复 | host pending/request/timer 设施；waiting 中新增请求初始暂停 |
| main 6 分钟 interval watchdog、writer 15 秒 stall | 原独立 Adapter 设施；不是 host remaining-budget，也不迁入 core |
| stream/tool/final/retired ledger、历史 toolResult 关联 | 后续 `ConversationStreamApplication` 独占；与 runtime 在 host 并列组合、同 close 路径同步失效 |

正常顺序由迁移前后同一 Fake edge golden 固定：pre-show state 通知（首次显示仍可能是 idle）→ 注册/等待 state → extension-ui；退休为 closed → state → deadline 同步。打开 dialog 仍令 observed=true；wait 期间 underlying 继续更新，最后 dialog 恢复最新值；agent_end/compaction_end/retry_end 不制造 idle，settled 才 idle。timeout 0 不调度、cancel 是回答、timeout 不合成 Pi 回答。clear_queue 返回值独立于 queue_update cache，clear 失败不恢复/abort，abort 失败不撤回或重复恢复。

**确认的失败路径修正**：close/child exit 同步 invalidate，清 host pending/timer；clear、answer、handshake 的迟到 continuation 不再发布恢复/成功/ready，不误退休重用 ID 的新 dialog。普通 observer 异常不阻断内部退休与 cleanup；但 stop 的同步 recovery outlet 抛错必须 reject，不能继续 abort。host `postMessage` 失败属于 transport failure，关闭输出通道、invalidate 并沿既有 shutdown 清理，不递归 post、不重发 clear/recovery、不宣称草稿已送达；不写磁盘补救，也不扩大持久送达保证。这不是正常 golden 顺序变化或原生桌面已验收的声明。

已删除 host `underlyingActivity`、`observedActivity`、`runtimeState/updateState`、dialog 业务实例、stop/answer 编排及无 caller 的 `extension-dialogs.ts`。原 helper 业务测试改经同一 core Interface，raw 回答白名单与 writer/renderer 防御断言仍保留。后续 stream 子阶段已删除 host 的 stream/tools/finalTools/retiredTools/toolLocations/deltaBuffer 与 `normalizeHistory` 关联循环；24ms timer 设施、JSONL、request correlation/限额留 Adapter，批次规则在 stream core。

本轮实际验证限定显式无 spawn Fake 白名单、三个 tsconfig、既有 AST gate（新增 runtime 负例，脚本未改）、44/44 manifest/Git 集合与字节、整个 renderer/AGENTS/依赖及前批改动冻结对照、纯 build 的 worker/module/preload 静态检查。应用/desktop/Electron/Pi/child fixture/browser/smoke/lifecycle/IPC 验收、verify/package/dist/dev 未运行；手工桌面验收待用户。本子阶段当时尚欠的 typed worker envelope 后续状态见 [Worker 小节](#worker-typed-wire--terminal-interface阶段-3-仍未完成)；完整阶段 3 与原生对话桌面验收仍未完成，stream/tool/历史关联的后续实际状态见下节。

## Conversation stream/tool/history 子阶段（阶段 3 未完成）

调用路径：`Pi JSONL → ConversationStreamMapper / chat-normalize → worker 单实例 ConversationStreamApplication → streamNotificationDTO → 原 worker transport`。与 runtime core 并列组合，两者拥有不重叠语义并在同一 close/child-exit 路径同步失效；main 不实例化 stream、不另存完整 transcript，renderer reducer 和外部 IPC/DTO 冻结。

- Interface 仅 `accept`、`initializeHistory`、`invalidate`；封闭 input/notification 和独立 readonly message/block/tool/JSON 值不引用 shared wire、Node、Pi、Electron 或 React。真实 timer/JSON.parse 由 `StreamSchedulePort` / `ArgumentDecoderPort` 注入，Fake 使用同一 Interface。
- core 独占 active assistant/user ID 绑定、按 message/index/kind 的 24ms 批次、tool ID/location/final/retired ledger 和单遍 history 关联。Adapter 仅分配时间/随机/sequence ID、校验 Pi 结构与映射 DTO；host 原 Map、queue/flush 流程、message/tool merge 和 handshake seed 循环已删除，normalizer 原 `normalizeHistory` 导出/关联循环也删除，无兼容 wrapper。
- history/live 共用完整工具结果替换规则；累计 partial replace，final 的成员/name/args 权威，保留 execution 状态/输出/images/details。值更新不反向改写已发通知/历史 snapshot；只复制必要可变容器，JSON 叶子只读共享，不建立深 clone/transcript 管线。
- **三项明确失败路径修正**：close/exit 取消并丢弃未发 delta（不再 shutdown flush），首通知同步 close 抑制旧批次和未完成 final；partial arguments 仅完整非 null/非数组 JSON 对象可覆盖；snapshot observer 同步 close 后复查 closing，不再继续发布 running。前两项为计划批准修正，第三项实施中经主会话批准。detach batch/调度身份防 late tick 重放和旧 clear 误删新 batch；observer 异常失效并传播，Adapter 将 timer/transport failure 接回原幂等 shutdown，不吞失败或重播。非法 index 以 typed rejection 经 core 判断 active 后写原诊断，保持原文本/次数。
- 保留旧局限：result-before-call 丢弃、历史空 ID 不关联、重复 ID 只关联最近 call；history seed 覆盖相同 live ID 但不清其余 ledger、也不标 final；live 在 handshake 期间照常发，snapshot 可覆盖先到 live。全局 final/retired flags 不新增 ID 复用政策；未知 block 压缩、随机 fallback、argumentText 与 execution details 交错均保持。更广泛 observer 递归注入 history/final 的原子顺序未承诺。

本轮迁移前 Fake host suite（含正常 golden）29/29；新增目标断言在旧 host 8 红（两项批准修正），迁移后 host 44/44；扩展正常序列在保存的旧源码重跑 12/12；snapshot close 再入的新增断言在旧源码另有 1 红。实际执行显式 Fake 白名单（含原 runtime/send/Session core）、定向 JSONL/纯 reducer/CLI、三个 tsc、AST 正负例与冻结 SHA、纯 build；不执行任何产物。日志与本轮增量证据在 `/tmp/pua-conversation-stream-*`。应用/桌面/Electron/Pi/browser/外部进程 fixture、smoke/lifecycle/IPC 验收、verify/package/dist/dev 均未运行；原 browser 红项不改不跑，桌面交由用户人工验收。typed worker envelope 与 Terminal Interface 的后续有限落地见下节；该子阶段当时的 facade 删除已由后续 composition 完成；桌面验收仍后置，这不是完整阶段 3。

## Worker typed wire / Terminal Interface（阶段 3 仍未完成）

本批将 `shared/ipc/worker-protocol.ts` 作为 RPC/PTY 双向内部 wire 单一来源；`worker-schemas.ts` 在两侧从 `unknown` 解析控制字段并重建输入。RPC 仅 start/send/stop/extension-response/rename/close，PTY 仅 start/write/resize/ack/close。main 的 process handle 发送口和 private request 均接受闭合 union，不再接受任意 `Record` command；worker 内 Pi request 也列出全部现用命令。main 只物化已授权附件的路径和图片值；`参考文件路径`、JSON.stringify 路径、Pi image content、prompt/streamingBehavior 与 set_session_name 只由 RPC worker 解释。send/rename 内部成功响应改为无 data 的确认，外部 void/中文错误及 renderer DTO 未改变；无旧 command fallback。

- 有有效 requestId 的畸形请求回失败；main 对关联的畸形回复立即 reject 并清 slot/timer，不合成成功或重放。缺失关联 ID 的消息忽略，原 pending watchdog 不变；未知/过期 ID 不建立 pending。Extension 回答继续白名单重建及原中文 `Error:` 文本。没有新增粘贴/文本/路径/图像大小限制，PTY NUL 与 ACK 字符单位保持。
- RPC event 绑定当前 resource/session id；PID 在 graceful close 时仍可登记，wire exit 不释放所有权。**event parser 不是递归 transcript/tool JSON schema**：它检查 tag、session id、控制标量和外层 payload 容器；extension-ui 另按 `ExtensionUIRequest` 四个分支校验必需载荷、可选 placeholder/prefill 与有限数值 expiresAt 后重建请求，非法事件不转发 observer。嵌套 blocks/tool JSON 的信任仍来自同版本 worker mapper。不能用于不可信 Desktop IPC 消息的完整证明。
- worker 输出失败沿幂等 cleanup，不递归 post；PTY 新增同样的输出失效闩锁。main 普通 request 的同步 post 失败仍仅拒绝本次并允许显式重试，close fallback 仍先于发送安装。Session core、Conversation send/runtime/stream owner 与所有 timeout/cleanup 时序未迁移。
- `main/terminal.ts` 只有 submission-only `Terminal` Interface，由 `SessionProcessAdapter` 直接实现。`app/main/composition.ts` 装配该窄能力，main 三个 handler 直接使用它；旧 facade write/resize/acknowledge 转发方法已删除，无 TerminalApplication class、第二 registry 或所有权副本。早到 write 丢弃、resize 缓存启动尺寸及三种 missing-ID 行为保持。

typed worker 子阶段当时保留的 `main/sessions.ts` 已由下述 composition 子批真实删除；没有整类更名或叠加 facade。当时后置的 `contracts.ts` alias 已由后续架构批次删除；冻结 UI 收敛仍后置。

本批验证为三个 tsc、显式无 spawn 内存 Fake 白名单（含 worker/runtime/stream/send/Session core）、静态 AST 和冻结集合/hash、纯 build 与产物路径/CJS 静态检查；日志与增量在 `/tmp/pua-worker-terminal-*`。既有所有 host golden 输出也逐条经过新 main-side envelope parser；新覆盖 typed port 编译负例、语义 send/rename 精确 Pi mapping、非法/错误方向/缺 ID/错 session/close PID/PTY 大粘贴与输出失败。`tests/sessions.test.ts` 只迁移断言并 typecheck，因真实文件副作用未执行；protected-files 的临时文件测试亦未执行，只运行静态 checker。应用/desktop/Electron/Pi/browser/child fixture、smoke/lifecycle/IPC 验收、verify/package/dist/dev 均未启动，产物未执行。桌面人工验收、原 browser 红项与完整阶段 3 未完成，纯构建既有 chunk 告警不视为消除。

## Main composition：facade 已删除（阶段 3 桌面待用户）

- `src/app/main/composition.ts` 仅构造并连接三个唯一 owner，返回真实 core/Terminal 引用及独立创建/附件用例；`Pick` 隐藏 prepared create、Conversation open/invalidate 和资源 owner。`activity(id)` 只读投影，无 busy/DTO 缓存或第二 Map。
- `platform/filesystem/session-preparation.ts` 保留 `resolve(expandHome(cwd)) + stat().isDirectory()`，不 realpath；UUID 默认在 composition。`app/main/create-session.ts` 在异步准备前查准入/schema/intent，最后同步 reserve → register → chat open 无 await/observer。登记/open 抛错先同步 close 锁定；实际 cleanup 成功才由 removed → invalidate → forget 释放，失败抛原中文 CLEANUP_FAILED 并 sticky 保留占用。重复 ID 拒绝不补偿已有 owner。
- `main/session-mapper.ts` 只做中文结果/start 特例、detached DTO、busy 与外部事件映射；`app/main/chat-attachments.ts` 只做 source staging、Conversation 登记、展示映射与错误转换，既有 attachment path 不变。main 直接调用 typed Conversation/Terminal；所有 close/closeAll（含 recentProjects 写失败、renderer crash、退出）先 unwrap 失败值，不能将 fulfilled cleanup-failed 当退出成功。main 的 21 invoke / 3 send / 1 event、sender → parser → handler、runtime 参数验证顺序保持。
- worker 绝对路径由 composition 的 `../../main/{rpc-host,pty-host}.js` 按文件 URL 计算，编译后仍指向 dist/main。tsc 不删除已移除源的旧输出，当时 preload 纯 buildStart 只清理 `dist/main/sessions.js` 和 `.map`；本次 main 入口退休后的有限清单见下节，仍非完整 clean-build 治理。
- 本轮验证使用新 Fake composition/create、纯 fs preparation mock、迁移后的 process adapter 与原 Session/Conversation/worker/IPC mock 白名单，三 tsc、AST（补 src/app 禁入与 channel seam）、44 冻结及全 renderer/hash、纯 build/静态输出链接检查。`tests/sessions.test.ts` 保留真实 fs characterization，仅迁移 Interface 与 typecheck，不执行；所有应用/产物、Electron/Pi/browser/外部 fixture、smoke/lifecycle/IPC 验收、verify/package/dist/dev 均未运行。具体命令与本轮证据在 `/tmp/pua-sessions-composition-*`，不以此前绿项代替本轮验证。

这是删除过渡 facade 的有限完成，不是整个目标架构完成。阶段 2 桌面生命周期及阶段 3 原生对话待用户人工验收；后续 main 边缘拆分的当前状态见下节；后续 Git/Preferences 有限状态见下文。该批当时尚欠的非 UI platform/worker、Workspace/renderer 路径与类型兼容入口已由后续结构迁移完成；UI 治理和运行验证仍后置。

## Main 启动 / 窗口 / lifecycle / menu / IPC（有限边缘拆分）

真实生产入口为 `src/app/main/bootstrap.ts`，`package.main` 指向 `dist/app/main/bootstrap.js`；旧 main/IPC 源已删除，不留转发文件。bootstrap 仅在 `app.whenReady().then(...)` 内读取设置并装配 Preferences 工作流（后续独立 storage/module 的当前归属见 Preferences 小节）、注册 IPC/菜单、构造安全窗口和唯一 core 后加载页面；无顶层 await，保留设置读取失败与外层启动失败的 dialog/exit。renderer/preload 通过新入口的文件 URL 计算，worker URL 仍由原 composition 计算。

| 职责 / 状态 | 当前 owner |
|---|---|
| BrowserWindow 安全策略、窗口/core 成对 holder、固定窗口事件出口 | `app/main/create-window.ts`；IPC 取当前 pair，单次 async handler 在 await 前捕获，旧事件不读取新 pair |
| 关闭确认、窗口关闭闩锁、共享 cleanup Promise、crash/close 各自诊断 | `app/main/lifecycle.ts`；不拥有 Session 准入或资源占用 |
| 平台菜单模板和点击行为 | `app/main/menu.ts`；保留 Darwin quit role 与 window-all-closed → app.quit，不增 before-quit/activate/重建 |
| Preferences runtime/bootstrap 与创建后写失败补偿 | `app/main/desktop-preferences.ts`；current/owned recents 已在后续 Preferences 子批迁入 module，见下文 |
| sender → tuple parser、21 invoke / 3 send 注册 | `platform/electron/ipc/{registrar,register-desktop-ipc}.ts`；闭合 typed dependencies，不暴露 handler record 或新 renderer 能力 |
| Session / Conversation / Terminal / 创建和附件用例 | 原 composition/core/adapter/mapper，唯一 owner 不变 |

关闭事件先 preventDefault。busy 取消不调用 closeAll、不封准入；接受关闭同步请求原 core.closeAll，在可重入调用前安装窗口闩锁和共享清理任务。重复 close 与 crash 共享同一窗口任务，所有结果先 unwrap，真实 cleanup rejection 或 `{ ok: false }` 不会被当作成功。成功才 destroy 绑定窗口并按原行为 quit；失败保留窗口、占用和 notice，允许再次确认但不恢复 core shutdown、不重试 sticky cleanup。crash 单独发生不新增 quit；close/crash 交错先处理该次 crash 的正确诊断，后决定退出。投影/诊断 observer 异常不影响真实 cleanup 结果。窗口身份防线不是多窗口产品能力。

Preferences 保留 Chat args 校验 → runtime 解析 → 创建顺序，recentProjects 由桌面持有，write 成功才发布；创建后写失败先 close/unwrap，cleanup 失败仍覆盖原写错误。窗口 sandbox/contextIsolation/no-Node、新窗口/navigation/permission deny 和冻结 HTML CSP 均保持。精确 sender、main frame、renderer URL（含 query/hash 拒绝）继续先于 parser/副作用。

preload buildStart 的迁移清单只 rm `dist/main/` 下的 `sessions.js`、`extension-dialogs.js`、`main.js`、`ipc.js` 及各自 `.map`，均配置 URL 转绝对路径、force 且不 recursive/glob。worker/preload/其它输出不在清单。未来独立授权的统一干净构建治理可替代该清单；当前不是全量 clean build。

本次验证仅三个 tsc、明确 Fake/静态白名单（真实注册函数、source bootstrap 的全部环境依赖 mock、窗口/菜单/关闭时序和真实 Session core + Fake Port）、扩展 app/platform AST 正负例、44 文件及全 renderer/AGENTS/依赖/Git 字节冻结、纯 build 与输出链接静态检查。原 IPC registrar/preload 白名单覆盖保留；rmSync 完全 mock 的构建清单测试不删除测试环境文件。证据与增量在 `/tmp/pua-main-boundaries-*`，初轮测试 Fake 时序/类型错误已修正并重跑，不引用旧批绿项。

没有运行任何应用/desktop/Electron/Pi/browser/外部进程 fixture、smoke/lifecycle/IPC 集成、verify/package/dist/dev、全量 test 或任何产物。原 smoke/deadline/lifecycle fixture/gate 源保持，旧真实 fs 测试未运行。原生菜单 Quit 和各平台退出事件顺序未实测，不能声称 native Quit 已证明先调用 window.close；桌面/原生对话、跨平台发布、既有浏览器红项仍待用户人工验收。Git/Preferences 在该边缘拆分批次未提取（后续有限状态见下文）；该批当时尚欠的 Workspace、其余非 UI platform/worker、renderer 路径和旧类型入口已由后续结构迁移完成。UI、格式/完整 lint 与运行验证仍后置，目标架构并未全量完成，构建既有大 chunk 告警仍在。

## Change Review：规则与 Git Adapter 有限提取

当前调用链：`app/main/bootstrap.ts → platform/electron/ipc/register-desktop-ipc.ts → modules/change-review/index.ts`；ready 中装配一个 `ChangeReviewApplication` 与 `platform/git/review-adapter.ts`，构造不查询仓库。旧 `main/git.ts` 已删除，生产与测试旧 import 清零，无兼容转发源。

| 规则 / 数据 / IO | 唯一 owner |
|---|---|
| scope 策略、每次最新 snapshot 的精确 destination 成员准入、tracked/untracked 选择 | Change Review domain/application；独立 readonly 值和稳定 `INVALID_SCOPE` / `STATUS_CHANGED` 失败 |
| root/branch/porcelain-z、clock timestamp、Git 参数/环境/timeout/buffer、路径安全/descriptor、binary/截断/overflow | Git Adapter；Port 仅 `captureSnapshot` / `readAuthorizedPreview`，core 不见任意命令或文件句柄 |
| sender → parser → Session cwd → 用例 → DTO / 原中文业务错误 | 既有 IPC registrar 与 `change-review-mapper.ts`；Git/fs 错误原样传播，外部 DTO/schema 不变 |
| renderer scope projection | `renderer/features/change-review/scope.ts` 的 `filesForScope`；不是第二业务 owner，由全状态字符组合对照测试约束，不被 domain import |

Snapshot 是观察，不与后续 diff/read 原子一致；不缓存、不锁、不重试。`AuthorizedPreview` 只是进程内成员准入值，不是防伪 token。保留 NUL 记录、换行/Unicode/leading-dash 路径和 rename destination/source 顺序，以及 lexical → lstat → realpath → O_NOFOLLOW open → fd/current identity 与 ancestry → read → finally close 原顺序。字符截断仍按 UTF-16 code unit，untracked 先读最多 200001 字节再 UTF-8 解码且依初次 size 标 truncated；stdout overflow 保留前缀、仍为 diff。这不扩大为无 TOCTOU 或跨 OS 安全证明。

本批仅补上 retired 清单中的 `dist/main/git.js/.map`；前批 sessions、extension-dialogs、main、ipc 的八条原样保留，Preferences/worker/preload 不被清理。验证为三个 tsc、具名纯 Fake/静态白名单、28 组迁移前保存源码与新组合的全 Fake 结果/IO 序列对照、AST 新路径正负例、44 文件及全 renderer/AGENTS/依赖冻结、纯 build 与 77 条 emitted import/URL 静态链接及 preload 仅 require Electron 检查。Git Adapter Fake 文件同时覆盖 race/close；旧 Git/fs 集成测试只迁 Interface 和 typecheck，未执行。初轮新测试的微任务等待假设已改为显式 fallback 信号并重跑。证据位于 `/tmp/pua-review-preferences-*`，不执行任何产物。

**该 Change Review 批次未提取 Preferences**；后续实际状态见下节。其独立实施仍保留冻结 shared schema、原并发 snapshot 局限与 Session 补偿优先级，不管理 Pi auth/trust/config。

未启动 app/桌面/Electron/Pi/browser/外部进程 fixture，未运行真实 Git/fs fixture、smoke/lifecycle/IPC 集成、verify/package/dist/dev 或全量 test。真实仓库与手工桌面/原生对话、原 browser 红项、跨平台发布仍待用户授权验收；该批当时尚欠的 Workspace、其余非 UI platform/runtime/worker、renderer 路径和旧 shared 类型入口已由后续结构迁移完成。UI 收敛、格式/完整 lint 与运行验证仍后置。该批仅 Change Review 代码与纯验证闭合，Preferences 后续有限状态见下节；两者不代表阶段 5 / 全量目标架构完成；构建既有大 chunk 告警保留。

## Preferences：桌面状态与磁盘 Adapter 有限提取

当前调用链：ready 中 `JsonPreferencesStorage.read → PreferencesApplication → createDesktopPreferences`。`modules/preferences/index.ts` 是唯一跨模块入口，独立 `PreferenceValues` 与窄持久化 Port 不引用 shared wire、Node、Electron、React 或 Pi；无需空 domain/facade 层。旧 `main/preferences.ts` 已删除，生产、测试及 mock 的旧 import 清零，真实 fs characterization 仅迁 Interface、保留但未执行。

| 状态 / 规则 / IO | 唯一 owner |
|---|---|
| current、客户端不能编辑的 recentProjects、保存成功发布、创建项目 promote/filter/slice(20) | `PreferencesApplication`；main 不持第二 current，其他重复 recent 不额外清洗 |
| IPC/disk 结构解析、theme/args/font/recents 兼容归一化 | 冻结 `shared/ipc/schemas.ts`；不反向 import core、不在 core 复制 validator |
| 默认值/JSON default spread、读错误包含 file、同步写校验与 detached validated snapshot、串行 mkdir/tmp0600/rename | `platform/filesystem/preferences-storage.ts`；queue 只管 IO，无业务 current/cache |
| runtime 参数校验/解析、bootstrap DTO、创建写失败 Session close/unwrap | `app/main/desktop-preferences.ts`；使用原调用捕获的 capabilities，不重新读取窗口 holder |

ENOENT 每次返回新对象/args/recents，不写文件；JSON null、primitive/array 先 default spread 再 shared parse。write 在 enqueue 前同步 validate，调用时 detached snapshot 不受后改影响；前次 IO 失败后下一写仍继续，严格 recursive mkdir → `.tmp` write(mode 0600) → rename，不加删除 tmp、close、重试或锁。read 不等写 queue。0600 是原写入选项，不宣称已有 tmp 权限一定被重设。

module 保存成功后发布**原输入引用**，紧接窄 completion 回调生成 bootstrap；创建后按完成时 current 构造 next，写失败在原 continuation 发起 close，await/unwrap 后才抛写错误，cleanup fulfilled failure/rejection 均优先。成功 completion 异常不进入写失败补偿。Chat args validate → runtime resolve → create 顺序不变。IO queue 与外层 save/create 并非事务：保留同时入队的旧 snapshot 覆盖、等待期修改输入导致 disk/current 不同，以及 initial/read/bootstrap 可变引用局限；失败不发布只是不主动替换 current，不保证外部引用不可修改。没有新增 renderer 能力、Pi auth/trust/model/settings 管理或全局线性化。

本批验证限于审查后的内存 Fake storage（真实实现 + 完全 mock fs）、真实 module 与 main runtime/Session Fake、原 sender → parser-before-effect 回归、AST 实际新路径正负例、三个 tsc、44 保护集合/Git a4fb717 字节与整 renderer/shared/范围外 SHA、纯 build/静态 emitted links。保存的迁移前 Store/workflow 源与迁移后真实组合通过全 Fake VM 比较结果、IO、publish→runtime、write failure→close 及并发 snapshot 序列；不执行 bootstrap/build 入口，VM 禁时钟/环境/未知 import，产品 fs 完全内存。证据与本轮相对 dirty-before 的增量位于 `/tmp/pua-preferences/` 和 `/tmp/pua-preferences.diff`。retired 精确清单前十项原序保留，仅追加 `dist/main/preferences.js`/`.map`，绝对路径、force、非 recursive/glob。

未运行 app/desktop/Electron/Pi/browser、真实 fs/Git fixture、外部进程产品测试、smoke/lifecycle/IPC 集成、verify/package/dist/dev、全量 test 或任何产物；bootstrap Fake 文件只迁 mock/typecheck，未运行。桌面/原生对话人工验收、原 browser 红项、真实 IO 与跨平台发布仍欠；该批当时尚欠的 Workspace、其余非 UI platform/runtime/worker、renderer 路径和 shared/contracts 兼容入口已由后续结构迁移完成。UI 收敛、格式/完整 lint 与运行验证仍后置。此为 Preferences 有限代码/纯验证，不是阶段 5 或全量目标架构完成，构建既有大 chunk 告警保留。

## 用户安装 Runtime / 环境 / Home expansion（有限平台归位）

`platform/pi/runtime/discovery.ts` 同步定位用户安装，隐藏 PATH/fallback/NVM、Windows package shim、realpath/header 与 Node 选择；`platform/pi/process/environment.ts` 构造每次启动的环境与 Terminal capability 广告。两者共用真实目录搜索，使用独立结构值，不引 shared wire、任意 exec Port、缓存、版本探测或新业务 core。`platform/filesystem/expand-home.ts` 由 discovery、resource inspection 和 session preparation 三处复用。旧 `main/runtime.ts` 与调用路径已删除，无兼容 facade；原十二条精确退休输出清单仅追加 `runtime.js/.map`，worker 输出不动。`scripts/smoke-pi.mjs` 仅更新 resolver import，未执行。

Chat 附加参数 exact/prefix policy 归已有 `app/main/desktop-preferences.ts` 创建边缘；validate → resolve → create 的同步调用顺序、Terminal 跳过、Preferences 引用/continuation 与 Session 补偿不变。环境仍只复制字符串，PATH 搜索优先与输出 key 枚举优先不同；保留既有 `ELECTRON_RUN_AS_NODE`，不新增该值。选择用户 Node 的注释不是完整 executable 身份检测保证。

该 Runtime 批次当时 **resource/preparation 本体后置**（后续归位见下节）：`main/project-resources.ts`、`main/session-preparation.ts` 仅迁 home import。六候选逐层扫描后查 `.git`、任意 access error 视为不存在、根层检查及现有 symlink/路径展示语义不变；这不是完整 Pi 资源加载复刻。异步准备后 UUID → 同步 reserve/register/open 仍在原 composition/create 用例。该 Runtime 批次没有迁移 renderer；当前项目/会话与每项目选择的后续 owner 见 Workspace 首 slice，草稿文本仍归 App presentation，未造后端 WorkspaceService/repository/application 空壳。

验证仅 source VM 的真实 adapter + 人工 fs/os/env/platform（Windows 配套 win32 path）、保存的 dirty-before runtime 与新链路结果/IO 顺序 golden、具名纯 Fake resource/preparation/Preferences/Session/worker-protocol、AST 新路径正负例、三 tsc、44 保护集合与全 renderer/shared/范围外字节冻结、纯 build/静态输出链接。证据在 `/tmp/pua-platform-runtime-before`、`/tmp/pua-platform-runtime.{diff,status,freeze}` 与 `/tmp/pua-platform-runtime.logs/`；旧 core/chat 真实 fs characterization 仅迁 import/typecheck、不删断言、不执行，bootstrap/process-adapter 测试本批只迁 mock/typecheck。

未运行 app/desktop/Electron/Pi/browser、真实 fs/Git 或外部进程 fixture、smoke/lifecycle/IPC 集成、verify/package/dist/dev、全量 test 或产物。真实安装/OS、桌面原生对话与生命周期、原 browser 红项、跨平台发布仍欠验收；该批当时尚欠的 worker/Pi 目录、Workspace 与 IPC 结构化结果已由后续结构迁移完成。UI、bounds、格式/完整 lint-release 治理与运行验证仍后置，不是完整阶段 3/5 或目标架构完成。

## Project resources / Session preparation（有限 filesystem 归位）

`platform/filesystem/project-resources.ts` 是 bootstrap 与 Desktop IPC dependency 共用的资源存在性 Adapter；`platform/filesystem/session-preparation.ts` 由 `app/main/composition.ts` 装配给既有 create 用例。旧 `main/project-resources.ts`、`main/session-preparation.ts` 与调用方/mock imports 已删除，无兼容转发、通用 FS abstraction 或空 Workspace domain。Workspace 的真实选择/草稿状态仍在 renderer，本批完全不动 renderer、visual demo、组件 tests、shared DTO/schema 或业务核心。

资源 Interface 仍逐层按原顺序检查六个候选，再检查 `.git`/根停止；任意 access 异常均当不存在，返回顺序、hasResources、lexical 路径和 access 的 symlink 语义不变，不读取资源内容/信任文件。准备仍 `resolve(expandHome(cwd)) → await stat → isDirectory`，保留中文非目录异常与原 stat 异常、basename/根标题。UUID 仍在 app 的 await 后；最终准入/reserve/register/open 原同步段完全不动，不增加 realpath 或路径安全保证。

本批验证为完整审查 setup 后的资源/preparation/Session composition/retired-output Fake 与 AST 静态白名单、三 tsc/noEmit、44 Git/manifest 集合与 SHA、全部 renderer/shared/core/诊断/menu 及范围外字节对照。真实 fs characterization 保留，仅迁资源 import 并 typecheck，未执行。retired buildStart 精确清单前十四项原序不变，仅追加 project-resources 与 session-preparation 的四个 js/map；rmSync Fake 断言完整十八项、绝对路径、force 且无 recursive/glob。当前运行 dist 不写入；在 `/tmp/pua-filesystem-edge-build` 源副本复用现有依赖完成纯 tsc/Vite 构建（Vite configLoader runner 避免共享 config cache 写入），仅静态检查 source/emitted imports、worker/preload/renderer 链接及旧输出缺失，不执行产物；保留既有大 chunk 告警。命令证据见本批 `/tmp/pua-filesystem-edge.logs/` 和交接记录。before 源字节/SHA/Git 状态在 `/tmp/pua-filesystem-edge-before`，增量相对该 dirty-before。

**最新手工事实与限制**：此前真实 Pi 助手回复缺失 P0 根因未定位；默认关诊断/source 回放没有复现，不能称修复，也无 a4fb717 之前的健康基线。后续原生 editMenu 修复粘贴，用户确认诊断模式能对话，再确认关闭诊断的普通模式粘贴、连续对话与切换显示“正常”。这只覆盖基本交互，不代表附件、queue、stop、Terminal 真实启动、设置、清理或发布全矩阵通过；P0 保留观察。诊断 code/tests/开关与菜单原修改完整保留。本批未操作、退出、重启用户应用，未发 Pi、执行产物或跑 browser/Electron/真实 fs/Git fixture、smoke/lifecycle/IPC 集成、verify/package/dist/dev/全量 test；前次手工启动许可不泛化为自动化授权。其余目标架构与完整桌面/跨平台验收仍未完成。

## Workspace/Renderer 首 slice（有限业务提取）

`renderer/features/workspace/index.ts` 是 App、跨 Feature 调用和测试的公开入口；同 Feature 内的 `WorkspaceNavigation.tsx` 直接使用本地 selection。`selection.ts` 是无 React/shared DTO/Node 依赖的纯 Module，用结构泛型携带调用方 session payload；`useWorkspace.ts` 接受现有 DesktopAPI 的 `onSessionEvent/closeSession` 窄 Pick，持唯一窗口内会话投影、active project/session、每项目 remembered selection。分组消费 Preferences 的 recents snapshot，不取得其 current/recents 权威；Session 生命周期、准入、释放与 Conversation 状态仍归原后端 owner。

App 已删除 Workspace state、通用 sessions setter、session-info/chat-state/exit 订阅与 close 协调。hook 将事件按原 id map 成显示投影；unknown/早到事件不创建 session，exit 不移除 tab。纯 selection 保留完整 cwd 身份、分组首次出现顺序、recent 空组、失效 remembered fallback，以及最后 active session 关闭后保留当前项目的规则。close 仅在 host truthy 后对最新 state 移除/修复；等待期切项目/选择其它会话/完成新建不会被旧选择覆盖，项目 memory 修复独立于当前全局选择；false 不变、异常仍 `String(error)`，不新增锁、去重或取消策略。

App 保留 create/rename 请求及完成顺序、每会话草稿文本、commands/search/review 和其余 dialogs；NewSessionDialog 的后续独立 owner 见 [Session Presentation](#session-presentationrenderer-有限提取)。成功 close 在原同一 Promise continuation 先 enqueue Workspace 移除、再同步回调 App 删除对应草稿；草稿删除不进 React updater，也不额外 await。所有 ChatPane/TerminalPane 仍按原 session.id key 始终挂载，仅切 active；其后仅路径迁入对应 Feature，组件体、样式、P0 诊断与 editMenu 不变。旧 `renderer/session-state.ts` 和真实 imports 已删除，无兼容转发或独立退休 JS 清理（renderer 由 Vite bundle）。

**当前授权与预览**：renderer 是条件解冻，不是永久整层冻结。此次只整理批准的生产业务；原 `ui/modules`、44 项组件 tests/视觉 demo `tests/component-preview` 保持路径、字节及 27 节点 import 闭包。辅助 `tests/workspace-preview` 仍使用真实 App，入口/fixture 未改，仅允许旧 selection 节点退出和新 feature 节点进入的传递依赖变化。未进行视觉整合、demo 搬迁、浏览器/动效或真实桌面验收，不能把静态构建称为视觉批准。

**纯验证与余项**：先在旧实现运行新增 selection 与真实 App + 内存 Fake Desktop/jsdom characterization，再在提取后重跑；Deferred 通过真实 dialog/tab/project/composer 操作覆盖 close/create 乱序、最新选择、false/reject、重复关闭、后台事件、草稿/附件身份与卸载订阅。隔离 stale-close 变异使三个选择断言失败；保存 before 源码 VM golden 对比纯状态输出/identity/输入不变。AST 门禁新增 selection 无依赖/宿主 global 禁令及 feature index seam，旧 backend 禁令不放宽。三个 tsc、component-preview tsc、明确 Fake/AST 白名单及隔离生产/preload/两套 preview 纯构建用于静态检查，不执行输出；当前运行 dist hash 保持。mixed `core/workspace-state` 的真实 fs 测试保留但不运行，前者仅迁 import/泛型类型，后者只迁出纯 Workspace 断言。

证据在 `/tmp/pua-workspace-renderer-before`、`/tmp/pua-workspace-renderer.logs/`、`/tmp/pua-workspace-renderer.{diff,status,freeze,previewclosure}`，增量相对累计 dirty-before，不是 HEAD 清理。该批当时尚欠的 renderer Feature 与 App composition 路径已由后续结构迁移完成；通用 UI 收敛、完整目标架构与真实产品 release matrix 仍欠。本批未操作/退出/重启用户应用，未运行 Electron/Pi/browser/真实 fs/Git fixture、smoke/lifecycle/IPC 集成、verify/package/dist/dev 或全量测试。用户普通模式粘贴、连续对话和切换手验通过的事实保留；助手回复缺失 P0 根因未定，纯测试不证明修复，也不宣新增 bugfix。

## Session Presentation/Renderer 有限提取

原有限提取先落在 `renderer/features/session-launch`，并将 rename presentation 暂放 Workspace；后续纯路径 consolidation 已将 `NewSessionDialog`、`useNewSessionLaunch`、`useSessionLaunchController`、`RenameDialog` 与 `useSessionPresentation` 统一迁入 `renderer/features/sessions`，旧目录和 Workspace 旧文件删除且无兼容转发。App 与 composition 只经 `features/sessions/index.ts` 使用这些能力；Workspace 继续独占 selection、输入与导航关系，不新增 launch/rename 状态。

`renderer/features/sessions/index.ts` 是真实 Session presentation 的唯一跨 Feature 入口。view 保留原 Modal、DOM/className、文案、radio 与 HTML required；内部 `useNewSessionLaunch` 拥有挂载局部 cwd/kind/mode/trust、250ms 检查与 active cleanup、busy/error、目录选择和提交 gate。它不是通用工作流 hook，也不复制 Session 准入、文件系统权限或 Pi trust 权威；资源检查只解释 host snapshot，trust 只作为本次创建参数。

App 仍决定 launch defaults/context 与设置跳转，保留 `createSession → workspace.addCreatedSession → close/reset modal → bootstrap refresh` 原 continuation，无额外 await、锁、缓存或自动提交。initial props 只初始化挂载状态；runtime/callback props 更新仍生效。当前保留的行为包括：未完成检查按 effect active 标志失效（即使 A→B→A）；已完成同 cwd snapshot 在重访 debounce 期间可复用；旧 inspection error 到下一结果前仍显示；Terminal 不受 Chat 检查 gate 限制；从 resume 切 Chat 的 kind effect 重置 new。目录选择按完成顺序覆盖输入，无 picker lock/cancel；成功提交由 App 卸载，异步 reject 恢复 busy，而同步 callback throw 仍逃逸并保持 busy。无 runtime 的原 form synthetic-submit bypass、autoFocus 先于 Modal 捕获焦点导致关闭后 body focus 等已记录而未趁提取修复。

验证为提取前后同一真实 dialog/App + 内存 Desktop/jsdom characterization、隔离敏感变异、三个 noEmit、AST feature index/宿主禁令、44 项与 27 节点视觉闭包/范围外/dist SHA、隔离生产与两 preview 纯构建及静态链接；不执行产物。`ui/modules/component-preview` 原位原字节，辅助 workspace-preview 入口/fixture 不改，仅新增 feature 传递依赖。本批未操作运行应用或运行 Electron/Pi/browser、真实 fs/Git/外部进程 fixture、smoke/lifecycle/IPC 集成、verify/dev/package/dist 或全量测试。证据在 `/tmp/pua-session-launch-before`、`/tmp/pua-session-launch.logs/` 与 `/tmp/pua-session-launch.{diff,status,freezes}`，相对累计 dirty-before。

后续 consolidation 只执行文件移动、import/index、静态边界、测试 source lookup 与文档更新；组件/hook 函数体、DOM/CSS/文案、状态、回调及异步/effect 行为不改。按用户要求未运行测试、npm、build、typecheck、smoke 或应用，仅做静态 read/search/diff 检查，因此模块解析与运行行为仍未执行确认。

Settings 的后续 owner 见下节；该批当时未整理的 palette、conversation presentation、草稿 owner 与 App composition 路径已由后续结构迁移完成，inspector 布局和视觉系统仍属后置 UI 范围。没有视觉替换或完整目标架构/桌面验收。用户普通模式粘贴/连续对话/切换手验事实不变，助手回复缺失 P0 根因未定，纯测试不宣称修复。

## Desktop settings/Renderer 有限提取

`renderer/features/preferences/index.ts` 是真实 `SettingsDialog` 的唯一入口；view 保留原 Modal/DOM/文案/按钮 type，内部 `useSettingsDraft` 拥有 mount-local preferences 引用、JSON args 文本、file pick、busy/error 与保存 continuation。App 删除旧实现，无导出 shim；settings open、boot projection、NewSessionDialog 设置跳转与实际 `useTheme` 应用仍归原 owner。main Preferences 继续独占 current/recents 与持久化；feature 不复制 shared validator，不管理 Pi auth/model/config，不新增 IPC/storage。

保留初始 `boot.preferences` 引用与 `JSON.stringify(args)`，props 更新只改变 live runtime display/callback，不重置 dirty draft。picker 完成 functional merge 最新字段，普通输入仍用 render closure；save 先 busy/清错，再原 JSON array/string-only 检查与 host 调用。保存结果原引用先 `onSave` 发布，再检查 runtimeError：有错误仍更新 App boot/theme，但保留 dialog 并恢复 busy；成功同 continuation close，回调抛错仍由原 catch 处理。关闭不取消 pending；synthetic 重复提交无额外锁，旧 save 成功可关闭后来重开的 dialog，乱序结果按完成顺序发布；这些既有限制没有借提取修复。

验证为提取前保存源码 VM 的真实 dialog与旧 App、提取后 public index/真实 App 的同一 Fake Desktop/jsdom characterization，覆盖选文件 → parse → runtimeError 发布保留 → 修正保存关闭、theme/bootstrap 和迟到 completion；隔离变异证明 picker merge、发布顺序、初始引用、无锁和同 continuation close 的断言敏感。三 noEmit、具名 Fake/AST 白名单、44 文件与 27 节点视觉闭包、范围外/dist SHA、隔离生产/preload/两 preview 纯构建及静态链接通过；未执行输出或操作运行应用。辅助 workspace-preview 入口/fixture/config 不改，仅新增 preferences feature 传递依赖；无视觉整合、Electron/Pi/browser/真实 IO/桌面或全量验收。证据在 `/tmp/pua-renderer-settings-before`、`/tmp/pua-renderer-settings.{diff,status,logs,freezes,closure}`，增量相对本批 dirty-before。该批当时尚欠的 Rename、palette、conversation 与 App composition 路径已由后续结构迁移完成；inspector/UI、完整目标架构和 release matrix 仍未完成。普通模式手验事实与助手缺失 P0 未定位的观察保持。

## Command palette/Renderer 有限提取

`renderer/features/command-palette/index.ts` 是 App 与 feature 测试的唯一入口。这里的命令面板是**命令文本插入器**，不是执行器：`useCommandPalette` 持 App 挂载级 open/query、按 session 的 ChatCommand 原数组缓存和当前 active 来源投影；`CommandPalette` 持原 Modal、label/name/description 大小写过滤、空来源提示与 ArrowDown/Up/Home/End 列表导航。Chat 只显示对应 ChatPane 从 RPC 提供的 commands；Terminal 九条 name/label/description/source 保持，不增加 Pi 能力。

App 保留草稿文本、Terminal handle 和原同步 insert：Chat 追加 newline，Terminal paste，正常返回才 `dismissAfterInsert`；throw 不关闭或清 query，无 finally/await。Git/reference/附件调用路径未改，附件等待期仍捕获旧 insert；面板选择使用最新 render callback。App 原单个 capture 快捷 listener 只替换 toggle 调用，稳定 action 保持原 boot.platform/active.kind 依赖、IME/229、preventDefault、modifier 匹配和 Shift F 搜索顺序，未拆监听。

关闭/cancel 保留 query；sidebar open 清 query；快捷 toggle 保留 query；成功插入 close+清 query。无 active 时 shortcut 仍切内部 open，回到 active 按其现值显示；Modal 卸载不重置 hook。相同命令数组引用不更新缓存，后台结果仅归对应 session，关闭 session 后缓存仍保留到 App 卸载。原 Modal autoFocus 先于捕获 previous 导致关闭后 body focus、列表 index=-1 的 ArrowUp 算法与过滤零项不显示空来源提示均按 before 保留，不借提取修复。

验证先运行真实旧 App/ChatPane/TerminalPane/Modal 与 Fake Desktop/native xterm 的 jsdom characterization，再同字节断言重跑提取后实现；不 mock App、面板、ChatPane 或 Virtuoso。覆盖动态/后台/多 session、草稿追加与九条 Terminal 插入不执行、生命周期、platform/IME/modifiers/capture、过滤与焦点、同数组不重投影、throw 与旧附件 continuation；独立 public hook 测试补稳定 action/reference。隔离源码副本变异检查状态 reset、错误 session 来源及自动执行防线的断言敏感性；三 noEmit、具名 Fake/AST 白名单、44 项和 27 节点视觉闭包、范围外/current dist SHA、隔离生产及两 preview 纯构建与静态链接证据位于 `/tmp/pua-command-palette-before`、`/tmp/pua-command-palette.{diff,status,logs,freeze,closure}`。增量相对累计 dirty-before，未清理既有改动或 main 退休输出清单。证据局限：开始快照漏掉 Git ignored 的 57 项设计文档/素材，后经批准单独 late-capture；它们未被编辑是实施方陈述与当前快照，不冒充本批 before 字节证明。实际修改路径均在本批改前保存；44/27/dist129 检查不受此遗漏影响。

原 ui/modules/component-preview 原位原字节；辅助 workspace-preview 入口/fixture/config 不改，仅随真实 App 增加 feature 依赖。未操作或重启运行应用，未执行产物、Electron/Pi/browser/真实 fs/Git fixture、smoke/lifecycle/IPC 集成、verify/dev/package/dist 或全量 test；静态构建不等于视觉/原生验收。该批当时尚欠的 Rename、conversation presentation/草稿 owner 与 App composition 路径已由后续结构迁移完成；inspector/UI、完整目标架构和 release matrix 仍欠。用户普通模式粘贴/对话/切换手验事实保留，助手缺失 P0 根因未定，不宣称修复。

## Strict Pi response：有限协议收尾

这是 Pi Adapter 的**安全契约修正**，不是 Conversation owner 提取，也不是助手回复缺失 P0 的根因或修复。`main/pi-response.ts` 集中现用 Pi command 与所消费载荷；`rpc-host.ts` 的 pending 保存预期 command，只按原 request id 关联。关联 response 必须 command 精确相等、success 为 boolean；false 必须有 string error（空字符串合法）。畸形响应先删除 slot/清 timer，再拒绝一次；未知、缺失、重复及迟到 id 不建立工作或复活请求。不新增重试、自动重放或普通命令协议失败后的全会话 shutdown；handshake 失败仍走原启动清理。

成功 clear_queue 必须返回非数组对象，steering/followUp 两字段都是完整 string[]，空数组合法；不补字段、过滤非法成员或用 queue cache 兜底。畸形 clear 不发 recovery、不继续 abort、不回成功，错误明确 acceptance/recovery unknown：Pi 可能已经清队列，不能承诺恢复文本未丢。合法顺序仍为同步 recovery → abort，abort 失败保留已恢复文本。queue_update 的兼容归一化独立保留。handshake 仅检查 state 对象与 messages/commands 数组，不递归约束 transcript；prompt/abort/set_session_name 可无 data，也不禁止未消费的额外 data。extension_ui_response 仍只等 writer 完成，不增加 Pi ACK。

本次只读核对 PATH 所指 Pi 安装包版本 **0.85.1**：`dist/modes/rpc/rpc-mode.js` 的 success/error、prompt preflight、clear_queue，`dist/core/agent-session.js` 的 clearQueue，以及 `docs/rpc.md`。0.84.4 是历史验证基线，本次没有其安装 source，不重新认证兼容性，也不猜测缺字段旧响应合法。mock-pi/lifecycle-pi fixture 现有 response 已带 command/boolean 与所需 payload，无需改动且未运行。旧 host golden 中缺 command/缺 clear 字段/畸形 clear 被迁为合法 payload，原顺序断言保留，非法行为另有拒绝矩阵；不是宣称所有旧输入等价。

验证：先在修改前 host 路径得到协议拒绝断言红项；真实 source worker + writer → utility parser → main Conversation token owner → 实际 ChatPane/jsdom 的四类弱 ACK 能错误成功，严格化后拒绝并保留提交草稿/chip/token，显式合法重试才消费。纯 Fake 白名单另保留等待暂停/remaining budget、背压、32 pending、乱序/重复/unknown id、shutdown/close-late 与 stop 失败顺序。三个 noEmit、既有 AST/44 保护门禁与 `/tmp` 隔离生产/preload 构建通过；产物只做静态链接检查，未执行。完整 before 含 ignored 项目文档/素材、原 dirty、当前 dist 与生产/两预览源闭包；原 renderer、shared、业务 core、diagnostics/menu、demo 与当前 dist 均未改。本轮日志在 `/tmp/pua-closeout-protocol.logs/`；可重复断言在仓库测试中，不依赖现场私密数据。

### 后续包与提交依赖

strict Pi 代码/纯验证已在 `e709f4d` checkpoint 提交；后续 DesktopResult + renderer client vertical 的当前有限状态见上文与 [契约](desktop-client-contract.md)。App 必要 continuation 的当前收尾见 [App composition](#app-composition窗口工作流归位有限代码收尾)，后续仍需 Preferences alias 行为修正及必要门禁。剩余 bounds 政策、Preferences 可变引用、生产 UI 收敛、formatter/完整 lint、真实桌面/跨平台 release gates 均未完成。原诊断默认关闭和 editMenu 修复保留；用户普通模式基本手验不等于当前候选树验收。

历史 strict Pi 候选当时是 `a4fb717` 以来累计 checkpoint，后经 review 提交为 `e709f4d`；以下保留当时依赖说明，不是当前 dirty 状态：新 helper/host 依赖累计 Conversation core/mappers、worker schema、process adapter、main composition/IPC/preload/build；App/Navigation 依赖新增 features 与旧源删除；diagnostics、测试/fixture/门禁/tsconfig、已 tracked 架构文档也须依赖闭合。ignored 设计材料保留但不自动纳入提交。Main 必须用 HEAD＋明确路径 allowlist 构造完整候选树验证、独立累计 review，再决定 stage/commit；本实现未 stage/commit/push，不能用未提交 imports 偷偷满足候选闭包。禁止应用/Pi/browser/Electron/真实 fsGit fixture、smoke/lifecycle/IPC 集成与发布命令的本轮约束保持；真实验收后置而非删除目标条款。

## RPC host 不变约束

1. JSONL 只按 LF 分帧，尾部 CR 可剥离；使用 `StringDecoder` 保留跨 chunk UTF-8，U+2028/U+2029 不是分隔符。
2. 单条入站记录上限 64 MiB，stderr 只保留 64 KiB 尾部。malformed/超限只结束对应会话。
3. `message_update` 按 `contentIndex` 合并；文本 delta 约 24 ms 批量跨 utility/main IPC；`message_end` 前强制 flush，最终 message 是权威值。
4. 工具按 `toolCallId` 关联。update 的 `partialResult` 是累计值，替换而非追加；并行工具可交错和乱序完成。
5. Agent 运行的完全空闲由 `agent_settled` 判定；扩展专用命令的 UI 等待独立于 agent activity，完成后恢复最新 underlying 状态，不要求并不存在的 settled 事件；`agent_end` 后仍可能自动重试、压缩或处理队列。
6. stop 必须先 `clear_queue`，通过 `chat-queue-recovered` 事件立即恢复队列文本，再等待 `abort`；renderer 按请求 id 去重，abort 失败不会丢失已经清出的文本。`stopChat` 的完成值不再承载草稿。
7. 子进程退出拒绝所有 pending 请求；关闭先结束 stdin，再超时终止 utility/子进程。renderer 崩溃或应用退出会关闭全部会话。
8. 启动期允许已验证的扩展对话回答，握手计时在等待用户期间暂停；`timeout: 0` 与 Pi 一致表示不设超时。窗口关闭先封锁新建/启动准入，再等待所有已有会话清理，异步目录检查后必须再次检查准入。
9. Pi 0.84.4 是历史测试基线；本次只读核对的安装 source 为 0.85.1，兼容证据范围见 Strict Pi 小节。handshake 使用 `get_state`、`get_messages`、`get_commands`；不兼容时明确报错，不静默解析终端输出。

## 安全与所有权

- renderer 保持 sandbox/contextIsolation、无 Node、无外网 `connect-src`。Markdown 不启用 raw HTML；远程 Markdown 图片不加载；HTTP(S) 链接只经校验 IPC 打开。
- 附件由 main 的文件选择器登记为会话内 token。既有 `ChatAttachment.path` 会返回 renderer；本批没有新增路径能力，也不以“renderer 只见 opaque id”作为安全保证。发送参数只接受 attachment id，由 main 在对应 session 的登记表查找路径与图片数据，不能用 renderer 提供的任意路径替代登记。普通文件向 Pi 发送路径；受支持图片经大小/数量检查后编码为 RPC image content。发送或关闭后清理登记。
- PUA 不读取/回传 `auth.json` 或 `trust.json`。RPC 不显示内置信任提示，因此检测到项目资源时让用户明确选择沿用 Pi 默认、本次 `--approve` 或本次 `--no-approve`。
- chat 模式拒绝会破坏协议/会话/信任所有权的附加 CLI 参数；其他模型、工具、技能、扩展参数保持原样。
- 托管会话原子预留所有权，关闭后确认进程树退出才释放。恢复必须先关闭其他运行会话；恢复握手前禁止新建，之后允许明确的新 chat 并行。所有终端与所有其他托管会话互斥（`--no-session` 也不例外），因为终端可在内部任意 `/resume`；不约束外部 Pi 进程。首期 chat 只支持新建/继续最近，不做运行中模式切换。
- Pi 与扩展仍以用户权限运行；utility process 是故障和生命周期隔离，不是权限沙箱。

## 会话与界面状态

`SessionInfo` 将进程与业务活动拆开：

- `kind`: `chat | terminal`
- `processStatus`: `starting | running | exited`
- `activity`: `idle | responding | compacting | retrying | waiting-input`

Workspace input presentation 以 session id 持草稿文本；每个 ChatPane 保持自己的 reducer、虚拟列表位置、草稿 revision/ref、附件和扩展对话。切换侧栏不会重启进程或丢失后台事件。Git 面板仍展示会话启动目录所属仓库的只读快照；文件引用直接进入原生 composer。

## 已知能力差异

| 能力 | 原生对话 | 兼容终端 |
|---|---:|---:|
| Markdown、代码、工具卡片 | ✓ 原生结构化 | Pi TUI 渲染 |
| prompt/steer/follow-up/stop | ✓ RPC 事件 | ✓ Pi 快捷键 |
| extension select/confirm/input/editor | ✓ | ✓ |
| extension notify/status/string widget/title/editor text | ✓ | ✓ |
| 任意 custom/overlay/editor/header/footer/theme/renderer | 不支持 | ✓（受终端协议覆盖限制） |
| 新会话、继续最近 | ✓ | ✓ |
| 任意历史、模型、设置、登录、树/fork/clone | 首期未原生化 | ✓ |

## 下一步

原生历史浏览、模型/思考选择、会话树、fork/clone、统计与压缩界面应继续建立在稳定 RPC interface 上。实现前先定义同会话单写者的交接协议；不能用并行进程或解析会话屏幕文本绕过。

RPC 输入、对话等待、附件与关闭的具体限额和生命周期见 [评审修复后的边界](native-chat-design.md#评审修复后的边界)。

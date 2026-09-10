# PUA 原生对话技术设计

状态：0.3 已实现基线。验证记录见 [validation.md](validation.md)。

## 目标

桌面端的核心价值是对话交互和结果可读性，而不是把终端迁入另一个窗口。PUA 因此将用户本机 Pi 的结构化事件呈现为原生消息、Markdown、代码和工具卡片，同时保留一个明确的 TUI 兼容入口。

## 一手来源

- 历史设计/验证使用 Pi 0.84.4 本机安装包：`docs/rpc.md`、`docs/sdk.md`、`docs/extensions.md`、`docs/session-format.md`、`docs/usage.md`、`docs/tui.md`。对应上游仓库为 [earendil-works/pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)。
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) 与 [security](https://www.electronjs.org/docs/latest/tutorial/security)：main/preload/renderer/utility process 的职责及隔离要求。
- [react-markdown](https://github.com/remarkjs/react-markdown)：默认不使用 `dangerouslySetInnerHTML`，支持用 React 元素覆盖 Markdown 节点。
- [remark-gfm](https://github.com/remarkjs/remark-gfm)：GFM 表格、任务列表、删除线和 autolink。
- [rehype-highlight](https://github.com/rehypejs/rehype-highlight)：基于 lowlight/highlight.js 的 AST 代码高亮。
- [remend](https://github.com/vercel/streamdown/tree/main/packages/remend)：修复流式阶段未闭合 Markdown；完成文本不应被改写。
- [react-virtuoso](https://github.com/petyosi/react-virtuoso)：动态高度、ResizeObserver、长列表及保持滚动位置。

本次 strict response 收尾仅只读核对当前 PATH 所指 **Pi 0.85.1** 的 `dist/modes/rpc/rpc-mode.js`、`dist/core/agent-session.js` 与 `docs/rpc.md`：成功/失败均带 command、success 为 boolean，失败 error 为 string，clearQueue 返回 steering/followUp 两个 string[]。未执行 Pi、版本 CLI 或真实 history；未重新核对 0.84.4 source，不以历史版本名为缺字段/畸形 clear 提供兼容 fallback。当前严格 Interface 与未验收项见 [Strict Pi response](architecture.md#strict-pi-response有限协议收尾)。

## 方案比较

### 采用：用户 Pi RPC 子进程

`pi --mode rpc` 给出命令响应、delta-only 消息流、工具生命周期、队列、重试、压缩、`agent_settled` 与 extension UI 子协议。它让 PUA 使用业务事件而不是 ANSI 猜测，并继续使用用户实际安装版本及其配置。

RPC 进程由 Electron utility process host 启动和解析。这样 Pi/扩展仍在独立进程，超大历史 JSON 解析或协议错误不会直接运行在 renderer，main 只转发 PUA 归一化事件。

### 保留：PTY/xterm adapter

Pi 文档明确说明 RPC 中 `custom()` 返回 `undefined`，自定义 editor/header/footer/theme 和 renderer 无原生等价。TUI adapter 因此不是主产品界面，但仍是登录、设置、历史选择及自定义 TUI 扩展的必要兼容能力。

### 拒绝：主界面继续使用 xterm

终端只提供字符/控制序列，无法可靠区分消息、工具、重试、settled 或 extension dialog，也无法达到桌面对话产品的阅读和操作闭环。

### 拒绝：应用内嵌 Pi SDK

SDK 对 Node/TypeScript 很方便，但会把 PUA 绑定到打包时的 Pi 包版本。当前产品承诺使用用户本机 Pi 与其扩展版本，因此进程协议是更清晰的 seam。

### 拒绝：直接引入 Streamdown

Streamdown 对流式 Markdown 很有针对性，但当前包预设 Tailwind/shadcn 设计令牌和 UI 约定。PUA 已有纯 CSS 视觉系统，使用 `react-markdown + remark-gfm + rehype-highlight + remend` 可以得到必要能力且保持更小的界面耦合。

## 对话领域 interface

renderer 只依赖 `src/shared/chat.ts`：

- `ChatMessage` 由 text/thinking/tool blocks 组成；
- `ToolActivity` 独立表达 pending/running/success/error、参数、累计输出和 details；
- `ChatSnapshot` 提供恢复消息、命令、model/thinking、队列、状态和 widgets；
- `SessionEvent` 只包含 PUA 归一化事件，不包含任意 Pi RPC command/response。

RPC host 的 Adapter 隐藏 JSONL、request id、Pi 原始消息形状和前向兼容；worker-scoped Conversation stream core 通过封闭语义 Interface 独占 delta batching、工具最终权威与 history 关联。未知事件被忽略；已知事件字段在使用前做运行时检查。

## 流式与工具一致性

1. `message_start` 建立临时 assistant message id。
2. `text_delta`/`thinking_delta` 按 `contentIndex` 合并并定时批量发送。
3. toolcall start/end 建立 block 与 `toolCallId`；执行 update 用最新累计结果替换。
4. `message_end` 前 flush；最终 message 替换临时内容，但保留已收到的 terminal tool 状态。
5. `toolResult` 再次确认最终输出和错误状态。
6. `agent_settled` 才把 composer 状态还原为 idle。

流式文本先经 remend 补齐未闭合标记；完成消息始终使用 Pi 原文。Markdown raw HTML 不进入 DOM；链接与图片使用 PUA 自定义 React renderer。

## Extension UI 与诚实降级

原生处理 RPC 支持的 select、confirm、input、editor 以及 notify/status/widget/title/editor text。通用工具卡片显示扩展工具参数和文本输出，但不声称复现其 TUI `renderCall`/`renderResult`。需要 custom/overlay 或自定义编辑器的扩展必须在兼容终端运行。

## 信任、附件和会话

RPC 模式没有内置 trust prompt。PUA 只检测项目/祖先目录是否存在相关资源，不读取 trust 决定；用户选择是否传本次 `--approve`/`--no-approve`，默认仍由 Pi 自己决定。

文件选择由 main 完成并登记 opaque id。renderer 只能回传该 id；普通文件转换为明确路径列表，图片在 main/host 路径按 MIME、数量与大小限制编码。发送后登记失效。

首期不原生实现历史数据库。chat 只创建新会话或 `--continue` 最近会话；`--resume` 仍使用终端选择器。恢复必须先关闭其他运行会话，并在恢复握手完成前禁止新建历史；多个明确的新 chat 可并行。所有兼容终端（包括 `--no-session`）在启动、运行和关闭期间与任何其他托管会话互斥，因为终端可随时在内部 `/resume`。关闭预留在进程树确认退出后才释放。这只约束 PUA 管理的进程，不能约束外部启动的 Pi 或扩展主动重定向会话文件。

## 性能与后续门禁

- 入站记录 64 MiB、stderr 64 KiB；工具输出仍受 Pi 自身限制。
- delta 24 ms 批处理；消息列表使用动态高度虚拟化。
- 仅用户位于底部时跟随输出；否则显示“回到最新”。
- 当前 renderer 首包约 1 MiB minified，后续可通过动态加载 Markdown/highlight/terminal chunk 优化，但不阻塞功能正确性。
- macOS arm64 已作为第一验收平台；Windows/Linux、签名、公证、自动更新仍是发布前门禁。

## 评审修复后的边界

- 输入始终发送 `prompt` 加 `streamingBehavior: steer | followUp`，由 Pi 决定空闲立即运行、忙碌排队或执行扩展命令；不从可能过时的 UI 状态发送字面 `steer/follow_up`。
- 等待扩展 UI 独立于 agent activity；扩展专用命令可能没有 `agent_settled`，完成最后一个对话恢复最新 underlying activity，而不虚构 responding。保留超时并撤销已结束的 request id；main 与 host 分别重建响应白名单。
- 每条消息内容索引限制为 0–4095 的安全整数。最终消息决定工具成员、名称和参数，后续仅合并匹配工具执行结果，空结果可覆盖旧输出。
- main 串行登记附件预算，移除 chip 撤销 token，接受发送仅消费本次 token。草稿按提交修订号清空，编辑器预填和异步停止期间的新输入不会丢失。
- Pi response 仅按 pending id 关联并校验预期 command、严格 boolean 与必要载荷；畸形 ACK 不成功消费提交 token/草稿。clear 必须两个完整 string[]，畸形返回明确 acceptance/recovery unknown，不恢复、不 abort、不用缓存补救；合法空队列及 recovery → abort 顺序保留。extension_ui_response 不等普通 Pi ACK。此为安全契约修正，不是助手缺失 P0 修复。
- RPC 最多 32 个 pending 请求、32 MiB 输出积压；阻塞写 15 秒超时。普通请求 5 分钟 watchdog 在等待用户对话时暂停，main 另有 6 分钟 host watchdog；超时不自动重放接收状态未知的命令。
- POSIX 关闭前枚举后代（包括 Pi bash 工具的 detached 子组），TERM 后强制升级并确认存活状态；Windows 使用 taskkill /T。窗口退出等待清理；host 意外退出由 main 清理已登记 Pi 树。强制终止整个桌面主进程、utility host 在 spawn 后但 child PID 尚未登记前被强杀的极短窗口、扩展先行 daemonize/reparent 或 Pi 本身崩溃后已脱离父子树的进程不在已验证保证内。

## Session 提取后的实现归属（有限落地）

`modules/sessions` 的纯 policy/coordinator 独占托管 Session 的预留、准入和生命周期；main-side `session-process-adapter.ts` 持 utility/PID、唯一 cleanup 工作、pending/watchdog、附件物理资源与 worker activity projection，`app/main/composition.ts` 装配唯一实例，独立 create/附件用例与 `platform/filesystem/session-preparation.ts`、`main/session-mapper.ts` 分别负责准备/DTO/中文错误，旧 `main/sessions.ts` 已删除。RPC framing、streaming/final message、queue、Extension UI 与 PTY worker 协议不变；Conversation send/attachment application 在 main，后续 worker-scoped runtime 已提取 stop/activity/queue/Extension waiting；stream/tool/history 已由并列的 worker-scoped stream core 独占，host 只留 Adapter。

close/host exit 同步封锁 start；transport 结束立即拒绝 pending，cleanup 成功后才发布 exit 并释放所有权。cleanup 失败仍保留占用且不隐式重试；迟到 ready/title/附件读取不得复活会话。附件发送消费规则不变。旧平台限制（含 Windows taskkill 不确认错误、host 的 PID 尚未登记窗口）仍在，不扩大清理保证。

阶段 2 代码/纯测试完成，桌面生命周期待用户人工确认。本轮只执行经检查的无应用启动单测、类型/AST/hash 与纯 build；未运行 verify、smoke、Electron/浏览器或真实 Pi/child fixture。UI 冻结，不能视为完整阶段 2 验收；后续 Conversation 子阶段也不代表阶段 3 完成。

### Conversation send/attachment 当前归属

`modules/conversation` 独占预算、token、登记串行、单发送与确认消费。adapter 的 source/payload Map 只管理 path/句柄/base64/preview，预算准入回调在 stat 后、图片分配前运行；core 接口不暴露路径或 raw RPC。失败批次回滚资源，明确发送失败保留 token，成功只消费本次提交；同步 close 失效不释放 Session 所有权，晚读取/确认不复活新会话。原 `ChatAttachment.path` 返回值保留。stop/respond/rename 使用语义 typed Port；后续 stop/恢复队列、activity 与 Extension waiting 深编排已进入 worker 单实例 runtime core，流式/工具最终权威及 history 关联已进入独立 worker stream core。当前规则 owner、失效与 transport 发送失败修正见 [runtime 子阶段](architecture.md#conversation-runtime-子阶段stopactivitywaiting阶段-3-未完成)；当前装配见 [composition 状态](architecture.md#main-compositionfacade-已删除阶段-3-桌面待用户)。

### Conversation stream/tool/history 当前归属

`ConversationStreamApplication` 拥有 active message 绑定、24ms 批次规则、tool/location/final/retired ledger 和 history 单遍 ID 关联；`chat-normalize` / `ConversationStreamMapper` 只做原始结构归一化、ID 分配与 DTO 映射。真实 timer 和 JSON 参数解析经窄 Port 注入。host/normalizer 旧规则路径已删除，main 无第二份 transcript，renderer/IPC 不变。三项批准修正（失效丢弃 batch、partial 参数只接受 JSON 对象、snapshot observer close 后不发 running）、历史/ID/handshake 的保留局限和实际验证范围以 [stream 子阶段](architecture.md#conversation-streamtoolhistory-子阶段阶段-3-未完成) 为准。后续 typed worker envelope 与 Terminal Interface 的有限落地见下节；facade 已由后续 composition 子批删除；完整阶段 3 及原生桌面人工验收仍未完成。

### Worker wire 与 Terminal 当前归属

`shared/ipc/worker-protocol.ts` 闭合 RPC/PTY 双向消息，main 只发送语义 text/filePaths/images/queuePreference 与 rename name；worker 独占 Pi prompt/image content、文件引用文本及 set_session_name 映射。内部 send/rename ACK 不再回传未使用的 Pi data；外部 DTO、成功值和错误语义不变。两侧 parser 从 unknown 检查控制字段、相关 ID 和方向，Extension 仍重建白名单；RPC events 绑定资源 session，嵌套 transcript/tool JSON 仍信任同版本 mapper，并非完整递归 validator。

Terminal submission-only Interface 由原 process Adapter 实现，经 `app/main/composition.ts` 的真实 `terminal` 引用接入 main，无独立状态 owner 或转发 class。旧 `Sessions` 已删除；create 保持同步预留/登记/open 与失败 cleanup 补偿，纯 mapper 不持所有权。无桌面/原生/IPC/smoke/lifecycle/browser 验收或任何产物执行；纯 Fake、类型/AST/冻结 hash 与纯 build 的范围和剩余项见 [Worker 当前状态](architecture.md#worker-typed-wire--terminal-interface阶段-3-仍未完成)。

### Main 窗口关闭与入口当前归属

`app/main/bootstrap.ts` 是真实 entry；窗口安全/成对身份、lifecycle 和菜单独立，Desktop IPC 在 `platform/electron/ipc` 继续 sender → parser → typed handler。关闭取消不 shutdown，接受关闭同步调用 core.closeAll 并 unwrap，成功才 destroy/quit，失败保留占用及诊断；close/crash 共享每窗口清理但保留各自 notice，旧窗口事件不跨绑新 core。Preferences recentProjects 的桌面所有权、创建写失败补偿及 Chat args/runtime 顺序未变。入口输出/窄清理清单和实际纯 Fake/静态/build 验证见 [Main 边缘拆分](architecture.md#main-启动--窗口--lifecycle--menu--ipc有限边缘拆分)。无 Electron/原生退出实测；菜单 quit role 与原 app 退出策略保留，桌面生命周期/原生对话仍待用户人工验收，不代表目标架构完成。

### Preferences 当前归属

`modules/preferences` 独占桌面 current/owned recents 与写成功发布，`platform/filesystem/preferences-storage.ts` 只持磁盘兼容及串行 IO，shared schema 保留在 IPC/disk 边缘。main 仅 runtime/bootstrap 与创建写失败先 close/unwrap 补偿，Chat args → runtime → create、cleanup 错误优先和原并发 snapshot/可变引用局限不变。此提取不管理 Pi auth/trust/model/settings、不调整 Session/Conversation/runtime/lifecycle。实际纯 Fake/保存源码 golden、静态及纯 build 范围见 [Preferences 状态](architecture.md#preferences桌面状态与磁盘-adapter-有限提取)；无真实 IO 或桌面/原生对话验收，不代表阶段 5 完成。

### 用户安装与 Chat 参数边缘当前归属

`platform/pi/runtime/discovery.ts` 只读定位用户 Pi/Node，`platform/pi/process/environment.ts` 每次构造进程/Terminal 环境；不运行候选文件或探测版本。原 Chat flags/prefix 校验在 `app/main/desktop-preferences.ts`，仍先于 runtime/create，Terminal 保留原参数能力。共享 home expansion 与 resource/preparation 本体现已归 `platform/filesystem`，旧 main 源删除；app 中 await 后的 UUID 与同步 reserve/register/open 时序不变，Workspace 状态仍在 renderer。纯 Fake/source golden 与静态验证不代表真实安装、跨平台或桌面原生对话验收，实际范围见 [Runtime 平台归位](architecture.md#用户安装-runtime--环境--home-expansion有限平台归位)。

### filesystem 归位与最新手工观察

资源存在性扫描与 cwd 准备的当前路径、无行为变更约束、纯验证与运行应用保护见 [filesystem 当前状态](architecture.md#project-resources--session-preparation有限-filesystem-归位)。用户已在原生 editMenu 粘贴修复后确认普通模式粘贴、连续对话和切换显示正常；这不是附件/queue/stop/Terminal 真实启动/设置/清理/发布全矩阵验收。原助手回复缺失 P0 根因仍未定，默认关诊断与 source 回放未复现不等于修复，不假定 a4fb717 前健康基线；诊断及开关保留观察，本批未操作或重启应用。

### DesktopResult / renderer client 当前契约

后续 Desktop invoke 已在 shared edge 使用 Result，renderer 经唯一 client 解包与持有每订阅取消生命周期；原 Session/Conversation/PTY owner、草稿/附件/queue 与 Pi protocol 不变。21 invoke / 3同步send / 1event、错误兼容、安全与纯验证限制见 [Desktop client 契约](desktop-client-contract.md)。此为有限 vertical，不是 App composition-only、Preferences alias、UI 或真实桌面/原生对话/跨平台发布验收完成；原助手缺失 P0 未定位的观察保留。

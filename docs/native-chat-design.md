# PUA 原生对话技术设计

状态：0.3 已实现基线。验证记录见 [validation.md](validation.md)。

## 目标

桌面端的核心价值是对话交互和结果可读性，而不是把终端迁入另一个窗口。PUA 因此将用户本机 Pi 的结构化事件呈现为原生消息、Markdown、代码和工具卡片，同时保留一个明确的 TUI 兼容入口。

## 一手来源

- Pi 0.84.4 本机安装包：`docs/rpc.md`、`docs/sdk.md`、`docs/extensions.md`、`docs/session-format.md`、`docs/usage.md`、`docs/tui.md`。对应上游仓库为 [earendil-works/pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)。
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) 与 [security](https://www.electronjs.org/docs/latest/tutorial/security)：main/preload/renderer/utility process 的职责及隔离要求。
- [react-markdown](https://github.com/remarkjs/react-markdown)：默认不使用 `dangerouslySetInnerHTML`，支持用 React 元素覆盖 Markdown 节点。
- [remark-gfm](https://github.com/remarkjs/remark-gfm)：GFM 表格、任务列表、删除线和 autolink。
- [rehype-highlight](https://github.com/rehypejs/rehype-highlight)：基于 lowlight/highlight.js 的 AST 代码高亮。
- [remend](https://github.com/vercel/streamdown/tree/main/packages/remend)：修复流式阶段未闭合 Markdown；完成文本不应被改写。
- [react-virtuoso](https://github.com/petyosi/react-virtuoso)：动态高度、ResizeObserver、长列表及保持滚动位置。

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

RPC host 的 implementation 隐藏 JSONL、request id、Pi 原始消息形状、delta batching 和前向兼容。未知事件被忽略；已知事件字段在使用前做运行时检查。

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
- 等待扩展 UI 独立于 agent activity；扩展专用命令可能没有 `agent_settled`，完成对话恢复原 activity，而不虚构 responding。保留超时并撤销已结束的 request id；main 与 host 分别重建响应白名单。
- 每条消息内容索引限制为 0–4095 的安全整数。最终消息决定工具成员、名称和参数，后续仅合并匹配工具执行结果，空结果可覆盖旧输出。
- main 串行登记附件预算，移除 chip 撤销 token，接受发送仅消费本次 token。草稿按提交修订号清空，编辑器预填和异步停止期间的新输入不会丢失。
- RPC 最多 32 个 pending 请求、32 MiB 输出积压；阻塞写 15 秒超时。普通请求 5 分钟 watchdog 在等待用户对话时暂停，main 另有 6 分钟 host watchdog；超时不自动重放接收状态未知的命令。
- POSIX 关闭前枚举后代（包括 Pi bash 工具的 detached 子组），TERM 后强制升级并确认存活状态；Windows 使用 taskkill /T。窗口退出等待清理；host 意外退出由 main 清理已登记 Pi 树。强制终止整个桌面主进程、utility host 在 spawn 后但 child PID 尚未登记前被强杀的极短窗口、扩展先行 daemonize/reparent 或 Pi 本身崩溃后已脱离父子树的进程不在已验证保证内。

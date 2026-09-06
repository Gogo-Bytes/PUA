# PUA 桌面架构（0.3）

状态：已实现的原生对话优先架构。产品行为见 [README](../README.md)，技术取舍与协议细节见 [原生对话技术设计](native-chat-design.md)。

## 选型

**Electron + React/TypeScript + Pi RPC + 显式 PTY 兼容入口**。

原生对话是默认产品路径。PUA 不解析 ANSI 推断业务状态，而是消费 Pi 的消息、工具、队列、重试、压缩和 extension UI 事件。用户本机 Pi 仍拥有模型、凭据、工具、技能、扩展和会话文件。

PTY/xterm 不再是主界面，但仍是一个真实 adapter：RPC 明确无法承载任意 `ctx.ui.custom()`、自定义 editor/header/footer/theme 和 TUI renderer，登录、设置及首期未原生化的历史/树操作也继续从兼容终端进入。

## 进程与依赖方向

```text
React workspace
  ├─ ChatPane: PUA ChatMessage / ToolActivity / ExtensionUI
  ├─ GitPanel
  └─ TerminalPane (explicit compatibility only)
          │ narrow preload intent interface
          ▼
Electron main / Sessions seam
  ├─ chat adapter ── utilityProcess rpc-host ── child_process ── user pi --mode rpc
  └─ terminal adapter ── utilityProcess pty-host ── node-pty ── user pi TUI
```

`src/shared/chat.ts` 是 renderer 唯一需要理解的对话 interface。Pi 原始 RPC 对象、JSONL framing、请求 id、delta 批处理、历史归一化和协议错误集中在 `src/main/rpc-host.ts` 及其内部模块；renderer 不能发送任意 RPC command。

## RPC host 不变约束

1. JSONL 只按 LF 分帧，尾部 CR 可剥离；使用 `StringDecoder` 保留跨 chunk UTF-8，U+2028/U+2029 不是分隔符。
2. 单条入站记录上限 64 MiB，stderr 只保留 64 KiB 尾部。malformed/超限只结束对应会话。
3. `message_update` 按 `contentIndex` 合并；文本 delta 约 24 ms 批量跨 utility/main IPC；`message_end` 前强制 flush，最终 message 是权威值。
4. 工具按 `toolCallId` 关联。update 的 `partialResult` 是累计值，替换而非追加；并行工具可交错和乱序完成。
5. Agent 运行的完全空闲由 `agent_settled` 判定；扩展专用命令的 UI 等待独立于 agent activity，完成后恢复先前状态，不要求并不存在的 settled 事件；`agent_end` 后仍可能自动重试、压缩或处理队列。
6. stop 必须先 `clear_queue`，通过 `chat-queue-recovered` 事件立即恢复队列文本，再等待 `abort`；renderer 按请求 id 去重，abort 失败不会丢失已经清出的文本。`stopChat` 的完成值不再承载草稿。
7. 子进程退出拒绝所有 pending 请求；关闭先结束 stdin，再超时终止 utility/子进程。renderer 崩溃或应用退出会关闭全部会话。
8. 启动期允许已验证的扩展对话回答，握手计时在等待用户期间暂停；`timeout: 0` 与 Pi 一致表示不设超时。窗口关闭先封锁新建/启动准入，再等待所有已有会话清理，异步目录检查后必须再次检查准入。
9. 以 Pi 0.84.4 为当前测试基线。handshake 使用 `get_state`、`get_messages`、`get_commands`；不兼容时明确报错，不静默解析终端输出。

## 安全与所有权

- renderer 保持 sandbox/contextIsolation、无 Node、无外网 `connect-src`。Markdown 不启用 raw HTML；远程 Markdown 图片不加载；HTTP(S) 链接只经校验 IPC 打开。
- 附件由 main 的文件选择器登记为会话内 opaque id。普通文件只发送路径；受支持图片经大小/数量检查后编码为 RPC image content。发送或关闭后清理登记。
- PUA 不读取/回传 `auth.json` 或 `trust.json`。RPC 不显示内置信任提示，因此检测到项目资源时让用户明确选择沿用 Pi 默认、本次 `--approve` 或本次 `--no-approve`。
- chat 模式拒绝会破坏协议/会话/信任所有权的附加 CLI 参数；其他模型、工具、技能、扩展参数保持原样。
- 托管会话原子预留所有权，关闭后确认进程树退出才释放。恢复必须先关闭其他运行会话；恢复握手前禁止新建，之后允许明确的新 chat 并行。所有终端与所有其他托管会话互斥（`--no-session` 也不例外），因为终端可在内部任意 `/resume`；不约束外部 Pi 进程。首期 chat 只支持新建/继续最近，不做运行中模式切换。
- Pi 与扩展仍以用户权限运行；utility process 是故障和生命周期隔离，不是权限沙箱。

## 会话与界面状态

`SessionInfo` 将进程与业务活动拆开：

- `kind`: `chat | terminal`
- `processStatus`: `starting | running | exited`
- `activity`: `idle | responding | compacting | retrying | waiting-input`

每个 ChatPane 保持自己的 reducer、虚拟列表位置、草稿、附件和扩展对话。切换侧栏不会重启进程或丢失后台事件。Git 面板仍展示会话启动目录所属仓库的只读快照；文件引用直接进入原生 composer。

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

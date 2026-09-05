# 0.1 桌面架构

状态：已实现的终端优先基线。目标是方便使用用户自己的 Pi，不重写其运行策略。

## 选型

**Electron + React/TypeScript + xterm.js + node-pty**。

- Electron 的 Node/utility process 路线与 node-pty 衔接直接，Chromium 渲染环境跨平台相对一致；代价是分发体积、内存和原生模块 ABI 构建成本。
- Tauri 2 可使用系统 WebView 和 Rust 后端，但本项目仍要解决 PTY、Pi/Node 发现与 sidecar 生命周期；首版不为减小壳体积增加 Rust/Node 双运行时维护面。未进行体积/内存基准，不作倍数结论。
- 纯 RPC 聊天壳无法保留任意 `ctx.ui.custom`、footer/header 和编辑器替换。SDK 能嵌入 agent，但不能把任意终端组件自动变成 React。保留交互 Pi 是兼容基线，不是宣称任何终端协议都已兼容。

外部框架比较的官方链接与证据缺口在 [research.md](../research.md)。本机安装包 `@xterm/addon-image/README.md` 已直接确认 IIP/SIXEL 协议、内存上限与 alpha/beta 状态；本机 `electron/electron.d.ts` 为实际使用的 API 类型依据。

## 进程与依赖方向

```text
React workspace / xterm
          │ 窄 preload API（类型：src/shared/contracts.ts）
          ▼
Electron main
  ├─ PreferencesStore：仅桌面元数据
  ├─ runtime：用户 Pi / Node 路径解析、argv、PTY 环境
  └─ Sessions：标签页生命周期
          │ utilityProcess 消息
          ▼
PTY host（每个标签独立）
          │ node-pty
          ▼
用户已安装的 pi 交互 CLI
          └─ 原有 tools / skills / extensions / 模型 / sessions
```

Pi 不进入 Electron main/renderer 的模块图。不解析 ANSI 猜测 agent 是否空闲：UI 的「运行中」只表示进程存活。

## 不变约束

1. CLI 参数以数组传递，无 shell 字符串拼接；桌面不默认传任何工具过滤、trust 覆盖、system prompt 覆盖或禁用资源标志。
2. 测试使用隔离配置；生产运行保留 `PI_CODING_AGENT_DIR` 等用户环境。不读取或回传 auth.json 给 renderer。
3. 新 PTY 不是父终端的子窗口：清除父终端/multiplexer 的能力标识；设置 `TERM=xterm-256color`、真实 TERM_PROGRAM。仅在用户未明确指定时声明 addon 实现的 `PI_IMAGE_PROTOCOL=iterm2` 与 OSC 8。
4. renderer 禁用 Node、启用 sandbox/contextIsolation，CSP 禁止外网连接、任意脚本与导航；允许图片解码器所需 `wasm-unsafe-eval`，不允许普通 `unsafe-eval`。
5. 用户点击链接才经受校验 IPC 打开 HTTP(S)。这不是对 Pi 工具/扩展的协议限制，Pi 仍能按自身逻辑打开 OAuth 浏览器或运行任意程序。
6. xterm 先订阅，再启动 PTY；收到 write callback 才 ACK。高水位 256K 字符暂停读取，64K 恢复。后台标签持续消费，避免静默卡死。历史滚动与图片使用各自有界缓存。
7. 切换标签不重建 PTY。退出/关闭会终止 PTY，不保证主动 detach 的第三方进程树清理。会话历史归 Pi，而非桌面自建数据库。
8. Electron ESM 入口不能顶层 `await app.whenReady()`：ready 等模块求值完成，会产生启动死锁；使用 promise callback 初始化。

## 下一步设计方向

在这个基线上增加会话可读性、真实 Git diff、工作状态与通知，并研究可选的原生聊天视图。不能通过虚构状态或解析屏幕文案制造「结构化」数据；业务状态需要可靠的 Pi 事件接口。RPC 视图要显式列出能力差异，并保留终端入口；同一会话文件不应由两种模式并行写入。

当前具体 UI 与功能边界见 [README](../README.md)。

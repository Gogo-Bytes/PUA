# PUA — Pi Universal App

**Your desktop workspace for Pi.**

为 Pi 打造的桌面工作台。

PUA（**Pi Universal App**）给你已经在用的 **Pi coding agent** 一个原生对话桌面工作空间，将消息、工具活动、项目、会话和变更审查集中起来。它不是另一套 Agent：Pi 仍使用你的模型、凭据、工具、技能、扩展和会话文件，PUA 通过本机 Pi 的 RPC 协议呈现可读交互。

名称中的 **Pi** 指明基础能力来源，**Universal** 表达跨平台目标，**App** 明确桌面应用定位；并不代表所有平台均已通过验收。当前为 **0.3.0 原生对话预览版**，macOS arm64 优先验收；终端作为登录、设置与 TUI 专属扩展的显式兼容入口保留。

## 开始使用

需要 Node.js **22.19+**、npm，以及你自己安装的 Pi。桌面应用不会替你安装或更新 Pi。

```bash
npm ci
npm run dev
```

启动后选择项目文件夹，默认进入原生对话；需要 `/login`、`/settings`、原生历史选择器或任意 TUI 自定义组件时，在打开项目窗口选择「兼容终端」。应用优先查找 PATH 中的 Pi，兼容常见 NVM/Homebrew/npm 安装路径。找不到时，在「桌面设置」指定 Pi 可执行文件或包内 CLI `.js` 路径，以及系统 Node.js 路径。Finder/快捷方式启动不会继承终端临时设置的 API key 等环境变量，建议先在兼容终端使用 Pi `/login` 持久化凭据，或从配置好环境的终端启动桌面应用。

Windows 需要 Pi 本身要求的 Git Bash（或你已有的 Pi shell 配置）。原生模块没有合适预编译产物时，安装需要对应平台的 C++ 构建工具。不要复制别的平台的 `node_modules`。

## 已实现

- 原生对话默认入口：流式 Markdown/GFM、代码高亮与复制、折叠思考、结构化工具调用/结果卡片。
- 多行输入框与每会话草稿；Enter 发送、Shift+Enter 换行；运行中 Enter 引导当前任务、Alt+Enter 排到任务后。
- 可靠停止：先取回 steering/follow-up 队列并恢复到草稿，再中止当前运行；完全空闲以 Pi `agent_settled` 为准。
- 文件引用与 PNG/JPEG/WebP/GIF 图片附件；图片最多 4 张、单张 5 MiB、总计 10 MiB。
- RPC 扩展基础 UI：select、confirm、input、editor、notify、status、widget、title 和编辑器预填。
- 项目资源检测与明确的“沿用 Pi 决定 / 本次信任 / 本次不加载”选项；PUA 不读取或改写 `trust.json`。
- 新会话、继续最近会话、独立运行标签与后台更新；原生历史选择器首期保留在兼容终端。
- Git 变更审查：未暂存/已暂存范围、真实 diff、未跟踪文件预览，文件引用直接回填当前输入框。面板只读并显示整个仓库变更。
- 显式兼容终端保留 Pi 原生 TUI、自定义编辑器、登录、设置、历史选择、终端搜索、图片 addon 与 PTY 背压。
- Electron renderer 继续启用 sandbox/context isolation；RPC 在独立 utility process 中解析和归一化。

原生对话命令列表只展示 RPC 实际返回的扩展命令、提示模板和技能。Pi 内置 TUI 命令不会被伪装成 RPC 功能；请在兼容终端中使用 `/login`、`/settings`、`/resume`、`/tree` 等入口。

## 保留 Pi 的边界

- 不 fork Pi，不嵌入另一套 Pi SDK，不默认改模型、system prompt、工具集、技能或扩展发现规则。
- 不添加工具审批、任务预算、强制计划模式或工作流。Pi 原有项目信任提示仍由 Pi 处理，不偷偷加 `--approve`。
- Pi 使用原本的用户配置与会话文件；桌面只保存自己的启动路径、参数、字号和最近项目。
- Electron renderer 的 sandbox / context isolation / IPC 校验仅保护桌面界面；**Pi 和扩展仍具有当前用户权限，不是沙箱运行**。
- 明确的新 chat 可以并行；恢复须先关闭其他会话。兼容终端（包括 `--no-session`）与所有其他托管会话互斥，关闭清理完成后才释放占用。外部启动的 Pi 不受此约束；请勿在外部同时恢复同一会话。桌面不迁移或锁定 Pi 历史文件。

## 验证与构建

> 产品界面名称统一为 **PUA — Pi Universal App**。为避免破坏既有安装数据，本次仍保留 npm 包标识 `pi-desktop`、Electron app ID 与用户数据路径；打包产品名的迁移另行设计。

```bash
npm run typecheck
npm test                # 不调用模型的单元测试
npm run test:desktop    # 真实 Electron + PTY，使用离线 fixture
npm run test:pi         # 本机真实 Pi + 官方 modal-editor 示例，隔离配置且不调用模型
npm run package         # 本平台未签名的应用目录
npm run dist            # 本平台安装包；发布签名/公证需另外配置
```

`test:pi` 可用 `PI_DESKTOP_TEST_PI` / `PI_DESKTOP_TEST_NODE` 指定测试安装路径，要求该 Pi 包包含官方 `examples/extensions/modal-editor.ts`。不要将测试视为已验证真实 OAuth 或付费模型调用。

## 已知边界

- 原生对话以本机 Pi **0.84.4** 为当前协议测试基线。RPC capability handshake 失败会明确报错；不会静默退回终端或解析 ANSI 猜状态。
- 原生历史浏览、模型/思考选择、OAuth/凭据管理、会话树、fork/clone、压缩和 token/cost 统计尚未实现；这些能力继续由兼容终端提供。
- RPC 明确不支持任意 `ctx.ui.custom()`、自定义 editor/header/footer/theme 或 TUI renderer。扩展业务逻辑仍可运行，但这些呈现能力必须使用兼容终端。
- Git 面板显示会话**启动目录**所属仓库的手动刷新快照。若在 Pi 内切换了工作目录，面板不会伪装已同步；请另开对应项目。文本预览有显示上限，文件及 Pi 能力不受限制。
- 已验证 macOS arm64 的真实 Electron/PTY 和 Pi 0.84.4 自定义编辑器、`/settings`、`/quit`；其他 OS/架构、真实 OAuth、完整扩展生态仍待验证。
- xterm 不等价于全部现代终端协议；默认声明 addon 已支持的 iTerm2 图片协议，**不宣称支持 Kitty graphics 或完整 Kitty keyboard**。用户 Pi 设置/显式环境覆盖仍优先。图片 addon 上游标明 IIP alpha、SIXEL beta；图片粘贴与大图显示仍需专项验收。
- 终端搜索范围为当前 20,000 行滚动缓冲；完整历史仍在 Pi 原生会话中。关闭窗口会结束进程，不提供后台常驻或崩溃自动恢复。关闭时清理可发现的后代（含 Pi bash detached 子组）；已经 daemonize/reparent 脱离父子树的扩展进程仍按扩展自身生命周期管理。
- 附加 CLI 参数存入桌面设置，勿填写 API key。软件没有凭据编辑器，不复制 `auth.json`。
- 0.1 初始研究仅使用本机文档；0.2 补充 Electron/Tauri 与 Codex Desktop 对照；0.3 的原生对话技术决策与协议边界单独记录。Windows/Linux 真机发行、签名、公证和自动更新仍未验收。

详见 [原生对话技术设计](docs/native-chat-design.md)、[研究与兼容矩阵](research.md)、[Codex Desktop 对照研究](docs/codex-desktop-study.md)、[架构说明](docs/architecture.md)、[验证记录](docs/validation.md)。

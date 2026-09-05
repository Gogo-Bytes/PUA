# Pi Desktop

给你已经在用的 **Pi coding agent** 一个桌面工作空间。当前为 **0.2.0 终端优先预览版**，不是能力缩水的聊天代理，也还不是完整的原生聊天 GUI。

## 开始使用

需要 Node.js **22.19+**、npm，以及你自己安装的 Pi。桌面应用不会替你安装或更新 Pi。

```bash
npm ci
npm run dev
```

启动后选择项目文件夹。应用优先查找 PATH 中的 Pi，兼容常见 NVM/Homebrew/npm 安装路径。找不到时，在「桌面设置」指定 Pi 可执行文件或包内 CLI `.js` 路径，以及系统 Node.js 路径。Finder/快捷方式启动不会继承终端临时设置的 API key 等环境变量，建议使用 Pi `/login` 持久化凭据，或从配置好环境的终端启动桌面应用。

Windows 需要 Pi 本身要求的 Git Bash（或你已有的 Pi shell 配置）。原生模块没有合适预编译产物时，安装需要对应平台的 C++ 构建工具。不要复制别的平台的 `node_modules`。

## 已实现

- 项目选择、最近项目、独立 Pi 会话标签；切换标签不会终止运行。
- 新会话、继续最近会话、Pi 原生历史选择器。
- 原生 TUI，保留扩展自定义编辑器、界面与命令的运行入口。
- 命令面板、终端历史搜索、字号调整、每会话独立中文多行草稿、文件引用插入。
- 会话筛选和桌面显示名修改；不改写 Pi 原生历史，持久会话名仍使用 `/name`。
- Git 变更审查：未暂存/已暂存范围、真实 diff、未跟踪文件预览、文件引用加入当前会话草稿。面板只读，显示整个仓库变更，不仅是 Pi 修改。
- 文本复制粘贴、修改键 Enter 转发、iTerm2/SIXEL 图片渲染 addon。
- PTY 在 Electron utility process 中运行，输出消费确认与背压。
- 进程启动失败和退出状态显示，关闭运行会话前确认。

命令面板、草稿和文件引用**只粘贴到当前 Pi 输入位置，不自动执行**。请先确认 Pi 处于消息编辑器，而不是某个扩展对话框。原生 `/hotkeys` 才是你当前 Pi 快捷键的权威来源。

## 保留 Pi 的边界

- 不 fork Pi，不嵌入另一套 Pi SDK，不默认改模型、system prompt、工具集、技能或扩展发现规则。
- 不添加工具审批、任务预算、强制计划模式或工作流。Pi 原有项目信任提示仍由 Pi 处理，不偷偷加 `--approve`。
- Pi 使用原本的用户配置与会话文件；桌面只保存自己的启动路径、参数、字号和最近项目。
- Electron renderer 的 sandbox / context isolation / IPC 校验仅保护桌面界面；**Pi 和扩展仍具有当前用户权限，不是沙箱运行**。
- 请勿让两个进程同时恢复同一个 Pi 会话文件。当前桌面不拥有 Pi 会话数据库，也不自动迁移或锁定历史文件。

## 验证与构建

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

- 这版是桌面终端工作台。原生聊天气泡、结构化工具卡片、会话树侧栏、行内审查意见、任务通知尚未实现。
- Git 面板显示会话**启动目录**所属仓库的手动刷新快照。若在 Pi 内切换了工作目录，面板不会伪装已同步；请另开对应项目。文本预览有显示上限，文件及 Pi 能力不受限制。
- 已验证 macOS arm64 的真实 Electron/PTY 和 Pi 0.84.4 自定义编辑器、`/settings`、`/quit`；其他 OS/架构、真实 OAuth、完整扩展生态仍待验证。
- xterm 不等价于全部现代终端协议；默认声明 addon 已支持的 iTerm2 图片协议，**不宣称支持 Kitty graphics 或完整 Kitty keyboard**。用户 Pi 设置/显式环境覆盖仍优先。图片 addon 上游标明 IIP alpha、SIXEL beta；图片粘贴与大图显示仍需专项验收。
- 终端搜索范围为当前 20,000 行滚动缓冲；完整历史仍在 Pi 原生会话中。关闭窗口会结束进程，不提供后台常驻或崩溃自动恢复。扩展主动 detach 的进程仍按扩展自身生命周期管理。
- 附加 CLI 参数存入桌面设置，勿填写 API key。软件没有凭据编辑器，不复制 `auth.json`。
- 0.1 初始研究仅使用本机文档。0.2 已补充 Electron/Tauri 进程模型及 OpenAI 桌面工作流的官方网页研究；不等于所有框架功能、历史竞品版本或跨平台行为均已验证。

详见 [研究与兼容矩阵](research.md)、[Codex Desktop 对照研究](docs/codex-desktop-study.md)、[架构说明](docs/architecture.md)、[验证记录](docs/validation.md)。

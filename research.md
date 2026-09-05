# Research: Pi 桌面 GUI 架构与能力兼容

## Summary
首版建议 **Electron + xterm.js + 独立 PTY worker（node-pty）运行用户已安装的交互式 Pi**：用项目选择、标签页、搜索、字体/快捷键设置改善便利性，不先重写 Pi。完全原生聊天界面的 SDK/RPC 模式适合第二阶段，但不能宣称与任意 TUI 扩展等价；终端基线也必须验证图片、中文 IME、增强键盘协议，保留外部终端入口。

证据范围：完整阅读本机 Pi **0.84.4** 的下列文档及指定示例；当前仅有文件读写工具，经 supervisor 同意降级为本地文档研究。**未使用浏览器、未实时核验外部网站、未安装或运行 Pi、未改用户配置**。Electron/Tauri/xterm/node-pty 比较是待主会话官方页面复核的架构判断，不是实测结论。

## Findings

### 1. 高：任意 TUI 扩展不是可自动转换的 JSON UI
`docs/tui.md` 的组件接口是 `render(width): string[]`、`handleInput(data)`、`invalidate()`，可直接处理终端键盘、焦点、动画、overlay、图片和自定义编辑器。完整阅读的 `examples/extensions/modal-editor.ts` 实际替换编辑器并解释 Escape/hjkl；并非聊天气泡换皮即可保留。`docs/extensions.md` 还允许工具/消息/custom entry 的任意 TUI renderer。[TUI](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/tui.md) [Extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)

`docs/rpc.md` 明确：`custom()` 返回 undefined；footer/header/editor component/working indicator 等 no-op；widget 仅字符串数组，component factory 被忽略；`hasUI=true` 只证明基础对话可桥接，不能证明完整 TUI。纯 SDK 自定义前端也必须实现 UI host；SDK 的 `InteractiveMode` 可保留 TUI，但那仍是终端，不是任意组件转原生 GUI。[RPC](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/rpc.md) [SDK](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)

### 2. 高：不能把 RPC 的 prompt 当成全部 CLI 命令入口
`docs/rpc.md` 的 `get_commands` 只含扩展命令、skills 和模板；内置交互命令不会经 prompt 执行。文档命令清单没有 login/logout 命令；首版保留交互式 `/login`，系统浏览器完成授权；不能给原生 GUI 只加一个发送 `/login` 的按钮。SDK `ModelRuntime` 有 credential/login/logout 能力，但 provider-specific 授权回调、取消、浏览器打开、回调端口仍需实现和验证。`examples/sdk/09-api-keys-and-oauth.ts` 实际只演示默认/自定义 credential 路径及临时 API key，**没有完整 OAuth UI 示例**。[RPC](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/rpc.md) [SDK](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)

### 3. 高：保留能力不等于绕过 Pi trust，也不等于沙箱
本仓库已有 `.agents/skills`，会受到项目 trust 影响。README 和 `docs/skills.md` 说明：项目资源在信任后加载；RPC 无交互式信任提示，没有既有决定时默认 ask/never 忽略项目资源。不要为“兼容”偷偷加 `--approve`、禁用扩展或更换 `PI_CODING_AGENT_DIR`；应保留交互信任流程，并明确显示实际 cwd 和配置来源。[README](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/README.md) [Skills](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/skills.md)

Pi 扩展可直接使用 Node fs/进程并具有用户系统权限，skills 可以指示执行脚本。独立进程只是故障/生命周期隔离，不是权限沙箱。prompt-fallback 的“只读/架构专家”等角色文字也不是强制工具权限；本任务没有 adapter 配置证据，不能声称已经存在执行限制。建议 renderer 无 Node 权限，窄 IPC 仅允许指定会话的输入/resize/关闭；主进程不加载用户扩展，worker/CLI 按用户权限运行。这里的 IPC 防护是保护桌面壳，不是削弱用户授权给 Pi 的能力。

### 4. 中：subagent 是扩展能力，不应改造成强制内建工作流
README 明示 Pi 核心不内建 subagents。完整阅读的 `examples/extensions/subagent/README.md` 描述独立 Pi 子进程、streaming、取消传递、项目 agent 信任，以及此示例自己的 8 任务/4 并发限制；不能把这些示例限制当成 Pi 平台限制。PTY 路径保留已有扩展行为，仍须验证 PATH 找到相同 Pi、子进程树退出、扩展自己的外部依赖；RPC 可保留执行/结构化结果，但不会保留自定义 TUI 展示。[Subagent 示例](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/subagent/README.md)

## 诚实兼容矩阵
符号：✓ 文档/架构支持，△ 需客户端实现或端到端验证，✗ 当前协议不提供。不是已通过的运行测试。

| 能力 | 交互 CLI + PTY/xterm | RPC 原生聊天 GUI | SDK 自定义原生 GUI |
|---|---|---|---|
| 内置 tools、skills、扩展业务逻辑 | ✓ 保持 cwd/env/trust | ✓ 同时须处理项目 trust | ✓ 标准 ResourceLoader/正确绑定 |
| 任意 custom()/overlay/编辑器/renderer | △ 原组件运行，受终端协议覆盖限制 | ✗ custom/no-op 明确降级 | ✗ 无自动原生等价；需 TUI host 或逐扩展适配 |
| select/confirm/input/editor | ✓ 原 TUI | △ 完整实现 extension_ui_request/response | △ 实现 UI context |
| 内置 slash 命令及登录 | ✓ 原 CLI，OAuth 浏览器链路待测 | △ 使用对应 RPC；login 无文档命令 | △ 调用 API 并实现 provider 授权 UI |
| 自定义 OAuth/provider | △ 原 Pi 扩展链路待测 | △ 凭证复用可行，登录另建入口 | △ ModelRuntime/扩展/provider UI 集成 |
| subagents | △ 既有扩展原样执行，依赖需满足 | △ 执行可用，TUI 展示不等价 | △ 需正确绑定/资源/子进程管理 |
| 分支、恢复、压缩 | ✓ 原命令 | △ 已有 get_tree/get_entries/fork 等；非全部交互行为 | △ runtime 更换后重新订阅并 bindExtensions |
| 文本剪贴板/图片输入 | △ 区分终端粘贴与 Pi 读取系统图片 | △ 桌面剪贴板转 RPC image | △ 桌面剪贴板转 SDK ImageContent |
| 终端内联图片/中文 IME/增强键盘 | △ 重点验证，不可标满支持 | 不适用终端显示；GUI 自己实现输入/图片 | 不适用终端显示；GUI 自己实现输入/图片 |
| 已安装 Pi 与其扩展版本 | ✓ 不嵌入另一个 Pi | ✓ CLI 解耦，但须协议版本适配 | △ 默认与应用 SDK 版本绑定 |

图片特别说明：`docs/terminal-setup.md` 只列 Pi 的 kitty/iterm2 图片协议，不能凭 xterm “有 image addon”推断匹配。不要伪装 `TERM_PROGRAM` 为 Kitty/iTerm2 或强制未知能力；文字粘贴、系统图片读取、终端图片输出是三个独立测试项。中文 IME 需要正确硬件光标定位；增强 Enter/Alt/Ctrl/释放事件取决于完整终端链路。Windows 默认 Git Bash，`powershell` 工具可选但 `!`/`!!` 仍走 Bash。[Terminal setup](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/terminal-setup.md) [Windows](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/windows.md)

## 桌面框架取舍（外部链接未实时核验）

| 维度 | Electron | Tauri 2 |
|---|---|---|
| 渲染运行时 | 自带 Chromium/Node，终端视图跨平台可控性较强 | 系统 WebView，平台差异需逐项回归 |
| Pi/PTY 集成 | TS 生态直接；node-pty 原生模块需 Electron ABI/架构匹配和打包解包验证 | Rust PTY backend 或 Node sidecar；shell 插件启动进程本身不保证 PTY 语义 |
| 体积/内存 | 基础运行时更大；无本项目测量数字 | 通常更轻，但 Node/Pi sidecar 缩小优势；不承诺倍数 |
| 隔离 | sandbox/contextIsolation + 窄 preload IPC + 独立 worker | capabilities 限制前端 IPC；不自动限制 sidecar/扩展系统访问 |
| 分发 | 原生模块构建、签名、公证、installer、升级必须逐 OS/架构验证 | Rust/WebView/sidecar target matrix、权限、签名、公证同样要验证 |
| 本任务首版 | **优先：集成链路更短** | 次选：团队熟 Rust、轻量包优先且接受 sidecar/PTY 工程成本时 |

待主会话 live 官方核验：[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)、[security](https://www.electronjs.org/docs/latest/tutorial/security)、[native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)、[distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution)；[Tauri process model](https://v2.tauri.app/concept/process-model/)、[capabilities](https://v2.tauri.app/security/capabilities/)、[sidecar](https://v2.tauri.app/develop/sidecar/)、[distribution](https://v2.tauri.app/distribute/)；[xterm.js](https://xtermjs.org/)、[xterm image addon](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-image)、[node-pty](https://github.com/microsoft/node-pty)。无基准测试可支持具体大小/延迟/内存排名。

## 可行首版与升级路线

1. **便利壳优先**：项目选择 → 显示 Pi 路径/版本/cwd → 新建独立 PTY 标签页 → 原交互 Pi。提供复制、查找、缩放、拖放、快捷键提示和退出确认；不解析 ANSI 推断业务状态，不拦截全部 slash 命令，不默认更换模型/工具/系统提示。
2. **安装发现**：保存用户显式选择的可执行路径及必要 Node 路径；系统 PATH 发现失败给定位入口。macOS Finder 启动的环境不能假定含 nvm；Windows `.cmd` 启动需要专门处理，不能把用户路径拼成 shell 命令。已读取 package.json：Pi 0.84.4，bin=`dist/bundle/cli.js`，Node `>=22.19.0`；不得把本机 nvm 绝对路径硬编码到产品。
3. **版本归用户**：桌面应用和 Pi 升级分开；不自动安装/升级用户全局 Pi 或 packages，不复制/读取凭证给 renderer。缺 Pi 时清楚说明并给官方安装入口。以后若提供托管 Pi，明确与“使用已安装 Pi”并列、可选、固定版本并有升级回退策略；协议能力由实际版本探测，不假定网上 main 文档等于当前安装。
4. **生命周期**：每个标签页独立进程；PTY 输出背压/有界缓冲，UTF-8 正确解码，resize 同步行列；关闭先请求正常退出，再超时终止进程树。Pi extensions/subagents 不应进入 Electron 主进程。禁止不经确认把所有 OSC URL 打开、把输出解释成 HTML 或默许剪贴板读取；安全打开链接/剪贴板可提供可控授权，不能静默吞功能。
5. **第二阶段可选原生聊天**：独立 RPC worker 实现流式消息、工具详情、队列、基础扩展对话、会话列表。保留“终端模式”且标明能力差异。RPC 仅 LF 分帧，不能用 Node readline；按 `contentIndex` 合并增量，以 message_end 为权威，使用 agent_settled 而非 agent_end 判定完全空闲。不要同一 session JSONL 同时开 TUI/RPC 两个写入者；模式交接须先结束旧进程再恢复，明确运行中扩展状态不能无损迁移。

首个发布门槛：macOS/Windows/Linux 真机打包测试；中文输入/组合键/粘贴大文本/图片粘贴与输出/resize/外部编辑器；`modal-editor.ts` 与 overlay 类扩展；实际 OAuth 登录/取消/回调；含子进程的扩展取消；trust 后 `.agents/skills` 发现；启动失败与错误路径；退出无孤儿进程；有界输出压力。此轮均未运行。

## Sources

本地来源根路径 `P=/Users/gan/.nvm/versions/node/v22.22.3/lib/node_modules/@earendil-works/pi-coding-agent/`。上述 Pi 网络链接是文档自带仓库映射，**内容证据来自本地 P，不是网络抓取**；package.json repository 指向 `earendil-works/pi` 而文档仍引用 `pi-mono`，需核验重定向/版本快照。

- Kept（全文读完）：`P/README.md`、`P/package.json`；`P/docs/{sdk,rpc,tui,extensions,skills,terminal-setup,windows}.md`——模式、接口降级、平台、信任和版本一手证据。extensions.md 已续读至末尾。
- Kept（全文读完）：`P/examples/extensions/modal-editor.ts`、`P/examples/extensions/subagent/README.md`、`P/examples/sdk/09-api-keys-and-oauth.ts`——分别验证任意编辑器替换、示例 subagent 的性质、OAuth 示例覆盖不足。
- Kept（待验证线索，非已读外部证据）：上列 Electron/Tauri/xterm/node-pty 官方链接。
- Dropped：无实际网页搜索结果，因此没有可以诚实声称筛除的网页。未采用第三方体积宣传或过时 RPC API 名称。

## Gaps / residual-risks

- 外部实时官网研究未完成；由 supervisor 批准降级并由主会话补充，不可把本报告当作浏览器研究验收通过。
- 未穷尽全部相关示例源码：subagent index.ts/agents.ts、overlay-qa-tests.ts、rpc-extension-ui.ts 尚未全文阅读；providers/custom-provider/packages 等专项文档未纳入本次完整阅读。OAuth callback 和图片 addon 的当前实现仍需核查。
- 未运行、未构建、未做性能/跨平台实测；PTY 仅是最接近原始能力的路线，并非所有终端特性的无条件兼容承诺。
- 无 production 源码可做行级缺陷审查；上述 severity 是架构风险，并不是已存在代码漏洞。没有访问用户 auth.json/trust.json/settings.json，也没有独立验证 Git 暂存状态。

# PUA 验证记录

产品名称为 **PUA — Pi Universal App**。为保持 app id 和用户数据路径，本次打包产物名称仍为 `Pi Desktop.app`。

## 累计架构 checkpoint：strict Pi 有限收尾

HEAD 仍为 `a4fb717`，累计 dirty/new/deleted 均保留；下方 0.3 记录是历史实测，不代表当前完整候选树通过桌面/发布验收。本次协议安全修正与后续未完成包见 [Strict Pi 状态](architecture.md#strict-pi-response有限协议收尾)。

本轮仅执行三份 tsconfig 的 noEmit、经逐文件审计的内存 Fake/静态/jsdom 白名单、AST/44 文件保护与完整 before/after SHA/预览依赖闭包对照、`/tmp` 隔离 main/preload/renderer 纯构建及 emitted links 检查。新增红→绿测试经过真实 source RPC host/writer、utility parser、main Conversation token owner 与 ChatPane，证明弱 ACK 的协议缺口，不能证明用户助手缺失 P0 根因。旧合法 golden 迁移必要 command/clear 字段，畸形输入单列拒绝测试；mock/lifecycle Pi fixture 只读核对，无需协议修改且未运行。可重复测试在 `tests/rpc-host.test.ts` 与 `tests/missing-assistant-replay.test.tsx`，命令/红绿/类型/构建/hash 日志在 `/tmp/pua-closeout-protocol.logs/`。

本机安装包版本从 package.json 只读核对为 Pi 0.85.1，未执行 Pi 或读取真实 history。未操作、退出或重启用户普通模式应用；当前 dist、renderer/UI/demo/辅助 workspace-preview、diagnostics/menu 和业务 core 原位原字节保留。未运行 Electron/Pi/browser/真实 fsGit fixture、smoke/lifecycle/IPC 集成、verify/dev/package/dist/全量测试，也未执行任何构建产物。另在 `/tmp/pua-closeout-protocol-candidate` 以 HEAD archive＋显式累计变更/删除路径构造候选树，不包含 ignored 设计资料；逐字节对照当前源码，再运行同一三 noEmit、白名单、AST/保护与隔离构建。路径清单和 source SHA 在本轮 logs 中。这只闭合所列有限检查，不替代全部累计行为验收或 Main 的提交审核。没有 stage/commit/push；独立累计 review、候选路径私密性/文档依赖审核与 staged diff 复核仍待 Main，纯构建已有大 chunk 告警保留。

## 0.3.0（历史工作区验证）

验证环境：macOS arm64、Node.js 22.22.3、Electron 44.2.0、本机 Pi 0.84.4。

已执行并通过：

- `npm run typecheck`：main/utility/preload/shared 和 React renderer 严格类型检查。
- `npm test`：60 项。新增严格 LF JSONL、UTF-8 chunk、CRLF、U+2028、malformed/上限、stderr 尾部、历史工具合并、流式 reducer、工具乱序、chat CLI 参数、Markdown/GFM/highlight/raw HTML/外链/远程图片和工具卡片测试；新增响应注入/对话过期、内容索引、最终工具权威值、请求背压/超时、附件并发/撤销、原子恢复与终端排他、异步草稿/预填/停止和真实后代进程清理回归。另覆盖关机准入屏障、启动期对话响应/握手计时暂停、对话写入失败关闭、clear 成功后 abort 失败仍恢复草稿且不重复。
- `npm run test:desktop`：真实 Electron，离线双模式 fixture。覆盖默认 RPC chat、流式 Markdown/代码/工具、extension select 往返、steer/follow-up、clear-before-abort 草稿恢复、Git 引用回填、显式 PTY fallback、sandbox/外链边界与退出。实际 Virtuoso 验证 100 段流式文本自动跟随、上滚不抢位置、回到最新、工具展开/图片尺寸变化、后台切换恢复；断言回复/高亮代码/工具输出的准确剪贴板文本、退出后回复仍可复制、握手阻塞对话可回答且连接状态正确。
- `npm run test:pi`：隔离 `PI_CODING_AGENT_DIR` 与 `PI_OFFLINE=1`；真实本机 Pi RPC handshake、官方 `rpc-demo.ts` input/editor、取消后 idle、后续 prefill、启动 widget/status；临时离线扩展另测 confirm/timeout/零超时继续可回答，以及兼容终端官方 `modal-editor.ts`。不调用模型、不读写用户配置。
- `npm run test:lifecycle`：真实 Electron，忽略 EOF/SIGTERM 的 Pi fixture，加继承进程组与 detached 子进程；窗口正常退出、握手失败、renderer 崩溃、utility host SIGKILL 均无遗留 fixture PID。另验证 PTY 根进程响应 TERM 退出、已发现的 detached 后代忽略 TERM/HUP 时，host 仍完成 KILL 清理后退出。
- `npm run build`：通过。Vite 报告 renderer 首包约 1.06 MB minified / 313 KB gzip；提示仍保留，后续按需拆分 Markdown/highlight/terminal。
- `npm run package`：生成 `release/mac-arm64/Pi Desktop.app`，未签名、默认 Electron 图标；随后以 `PI_DESKTOP_TEST_EXECUTABLE` 对打包产物再次执行双模式 smoke，通过。

截图证据位于 `.agent-work/native-chat/evidence/`。图片 smoke 通过替换 Electron 原生文件选择器的返回值，实际经过 main 登记、四图移除/重选、RPC 发送及 transcript 显示；不是对操作系统文件选择器或真实模型视觉输入的验收。桌面 smoke 另包含有效 dialog id 携带伪造 RPC type 的注入回归、超时退出、多 chat 草稿/后台预填和最终工具参数/成员断言。Windows/Linux、真实 OAuth 和付费模型仍未验证。

### 最终复核与副作用披露

Main 亲自执行类型检查、60 项测试、桌面/Pi 离线 smoke、五类生命周期 smoke、重新打包及打包产物 smoke，均通过。最后两项单测验证 PTY 根进程退出后迟到的 resize/write/ack 不会打断后代清理，以及操作异常也等待清理完成后退出。独立 reviewer 已确认最后一个已知阻塞项修复，未发现该定点改动引入的新缺陷；reviewer 结论来自只读源码与测试审查，运行结果由 Main 实际执行，不冒充 reviewer 独立实测。

曾有一次生命周期测试脚本误用配置隔离参数，向普通 PUA 桌面设置 `/Users/gan/Library/Application Support/pi-desktop/desktop-settings.json` 添加了临时最近项目 `.../T/pua-lifecycle-rKwu8B`。这是已确认的桌面偏好副作用，不是 Pi 凭据或信任配置变更；未尝试恢复未知旧数据。修正后的全部测试使用临时 `--user-data-dir`。此前“不修改用户配置”的测试说明仅适用于修正后的隔离测试，不覆盖这次开发调试失误。

首期实现与已列出的本机离线验证已完成；未执行提交、推送或发布。此结论不扩大下方“尚未验证”范围。

## 0.2.0（历史工作区）

同一 macOS arm64 环境，2026-09-05 已重新执行并通过：

- `npm run typecheck`
- `npm test`：18 项，新增 staged/unstaged、索引不变、特殊文件名、符号链接替换竞态、超 8MiB tracked diff 有界预览、乱序关闭会话状态回归。
- `npm run test:desktop`：新增会话筛选/显示名、会话间草稿隔离、真实 Git diff 范围、引用加入草稿，以及 Git 刷新失败后不残留可点击引用。
- `npm run test:pi`：真实 Pi 自定义编辑器 /settings /quit 继续通过，无模型调用。
- `npm run package` 和打包产物的 `scripts/smoke-desktop.mjs`：通过。`release/mac-arm64/Pi Desktop.app` 现为 0.2.0，仍未签名。

独立 Reviewer 完成只读源码审查（其工具不具备测试执行能力）：发现 untracked symlink TOCTOU、大 diff 先溢出后截断、刷新失败残留引用、异步关闭标签选择竞态。Main 已修复并加入对应回归测试；未将 Main 的执行结果冒充 Reviewer 独立实测或再次批准。

0.2 的外部研究补充已在 [Codex 对照](codex-desktop-study.md) 和 [研究版本说明](../research.md) 记录。原生聊天、OAuth、完整图片/IME/终端协议及跨平台发布仍不在已验证范围。Git 预览还不是编辑器或 Git 操作客户端，不支持行内意见、暂存/回滚动作、分支对比。当前产物仍使用默认 Electron 图标；renderer 大 chunk 提示约 639KB 未压缩。

## 0.1.0（已推送基线 `95e360e`）

验证环境：macOS arm64、Node.js 22.22.3、Electron 44.2.0、本机 Pi 0.84.4。实际执行日期：2026-09-05（本机时钟）。

| 项目 | 结果 / 证据 |
|---|---|
| `npm run typecheck` | 通过：main/preload/shared 与 React renderer |
| `npm test` | 通过：8 项，覆盖背压、组合 Enter、文件引用编码、CLI 参数不经 shell、缺失安装、桌面设置校验/原子保存 |
| `npm run test:desktop` | 通过：真实 Electron 和 node-pty，不是网页 mock；Pi 进程使用无网络 fixture |
| `npm run test:pi` | 通过：真实已安装 Pi；临时 agent/profile/project；不调用模型、不修改已有配置 |
| `npm run package` | 通过：生成 `release/mac-arm64/Pi Desktop.app`，未签名、默认 Electron 图标 |
| 打包产物集成测试 | 通过：`PI_DESKTOP_TEST_EXECUTABLE="$PWD/release/mac-arm64/Pi Desktop.app/Contents/MacOS/Pi Desktop" node scripts/smoke-desktop.mjs` |
| 依赖安装审计 | npm install 报告 0 vulnerabilities；不是独立安全审计 |

## 0.1/0.2 历史桌面集成测试覆盖（0.3 终端已改为独占）

- 启动窗口、renderer 无 Node `require`。
- 真实 PTY 和 utility process，中文/空格 cwd，含 shell 元字符的 argv 原样传递。
- 中文多行草稿的 bracketed paste，以及 Shift+Enter 正确编码。
- 命令面板只插入 `/model`，不偷偷添加回车执行。
- 两个独立会话；后台标签消费 15,000 行输出后仍完成，无背压死锁。
- 切换标签、终端搜索、正常进程退出、关闭已退出标签。
- renderer 拒绝 `file:` 外部协议；未出现未处理页面异常。

## 真实 Pi 测试覆盖

加载 Pi 自带 `examples/extensions/modal-editor.ts`，验证自定义编辑器 `INSERT → NORMAL → INSERT` 转换，再打开 Pi 原生 `/settings`，最后 `/quit` 正常退出。该能力在 RPC 文档中明确降级，因此是终端路线的一条具体兼容证据；不是全部扩展已兼容的证明。

修复了测试实际暴露的问题：Electron ESM 顶层 await ready 导致启动死锁；图片 addon WASM 受 CSP 阻止；测试发送 Escape 后未等 Pi UI 切换造成组合输入竞态。

## 尚未验证

- 进程生命周期保证不覆盖 Electron main 被硬杀、utility host 在 child PID 尚未登记前崩溃的极短窗口，或发现前已 daemonize/reparent 的后代；当前已测退出路径不能证明这些边界。


- Windows / Linux / macOS x64 打包与真实运行；签名、公证、安装/升级、杀毒兼容。
- 付费模型执行、真实 OAuth 完整授权、真实模型图片输入、图片剪贴板、完整 IME 候选定位。
- 用户现有所有扩展及其额外依赖；RPC 不支持的 custom/overlay/editor/header/footer/theme/renderer 必须继续在兼容终端专项验收。
- 原生历史列表、模型/思考选择、会话树、fork/clone、统计与压缩界面。
- 超大（接近 64 MiB）真实会话历史与长时间运行的内存曲线；当前只有边界单测和常规集成测试。

构建仍有大 chunk 提示（renderer 同时包含 xterm、Markdown/highlight 与 React，约 1.06 MB 未压缩）；未隐藏提示，也未以未测量的拆包收益作性能承诺。


## DesktopResult + renderer client 有限验证

本包基于 clean `e709f4d`，完整 before（含 ignored 项目 docs/源码、dist）、diff/状态/候选 allowlist 与输入 hash、实际命令日志分别保存于 `/tmp/pua-desktop-client-before`、`/tmp/pua-desktop-client.diff`、`/tmp/pua-desktop-client.status`、`/tmp/pua-desktop-client-candidate`、`/tmp/pua-desktop-client.logs`。权威契约与行为兼容差异见 [Desktop client](desktop-client-contract.md)。仅记录本轮实际 pure Fake/jsdom、noEmit、AST/44字节/27闭包与隔离 pure build；不能以此前绿项或测试数量替代本轮候选核对。AST 参数化数量与行为测试分开统计在 handoff/logs。

运行中的应用与 dist 不动；无应用/产物/Electron/Pi/browser/真实fsGit/外部进程fixture/smoke/lifecycle/IPC集成/verify/dev/package/dist/全量 npm test，依赖仅使用原 node_modules link。源码 smoke 的成功/拒绝断言静态迁移但未执行。完整候选树经 Main 独立 review 后才决定 stage/commit，不 push。App composition、Prefs alias、bounds/完整lint/UI 与真实发布门禁仍后置，不宣称全架构完成或 P0 修复。

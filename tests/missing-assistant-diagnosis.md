# P0：已持久化 assistant 未显示（诊断待现场证据）

**P0 未修复；根因未定。** “暂停架构迁移”是当时诊断阶段的决定；此后用户已授权恢复，当前 strict Pi checkpoint 与后续收尾事实见 [架构记录](../docs/architecture.md#strict-pi-response有限协议收尾)。用户后来确认普通模式粘贴、连续对话与切换显示正常，只是基本交互手验，不是 P0 根因修复或当前候选树验收。

本文已确认事实、回放结果及“本批”表述均为当时的历史诊断快照：本批没有启动/重启应用、Electron、浏览器或 Pi，没有发送真实提示，没有读取凭据或其它会话历史，也未构建或触碰当时运行产物。累计 dirty tree 仍不是健康/干净基线。以下采证步骤面向未来，仍须另获用户对构建、启动/重启及人工发送的许可；恢复架构工作与此前手验许可不代替该授权。

## 已确认与未确认

- 用户指定 JSONL 的第 5 行：entry id `5afc539c`，message 无 id，role `assistant`，content 是数组，text 含 `PUA_ACCEPTANCE_OK`，stopReason `stop`。只提取这些字段，其他内容未导出。
- PATH 指向安装包 `@earendil-works/pi-coding-agent`，只读 package metadata 得到 `0.85.1`；不是执行 `pi --version`，也不是确认当前 Desktop 实际启动的版本。
- 安装包 `dist/modes/rpc/rpc-mode.js:266` 使用 `output(toJsonEvent(event))`；`dist/modes/json-event.js` 保留 start/end 的 `message`，update 只带 `usage` 与 `assistantMessageEvent`（去 partial；toolcall_start 提取 id/toolName）。`dist/core/agent-session.js:388` 在 message_end 持久化同一 message。实际 bundled CLI 引用的 `chunk-JVUZSMYM.js` 中对应三个生产点也已只读核对。
- **持久化 session 不是 wire trace**。这不能证明事件到达了 Desktop worker/main/renderer，也不能证明当前进程正在执行本批源码。没有 0.84.4 真实源码对照，版本差异为未证实假设。

## 新增反馈链及其限制

运行 `./node_modules/.bin/vitest run tests/missing-assistant-replay.test.tsx`：

真实 rpc-host/RpcWriter 源 VM + 全内存 Pi streams → JsonlDecoder → ConversationStreamMapper/StreamApplication → typed worker parser → SessionProcessAdapter/main composition → windowEventEmitter → ChatPane 自身订阅/reducer → 实际 Markdown/MessageView/Virtuoso DOM（jsdom 的官方 VirtuosoMockContext 固定测量）。send 经真实 ConversationApplication/adapter/worker 到内存 stdin。未知 VM import 立即失败；产品 fs/spawn/environment 都是 Fake，不执行安装包。

输入使用已核对源码契约与脱敏 final 形状；user、timestamp、ID、事件顺序是人工构造。断言对应 session 在 final→idle 后 user 和 assistant 正文均存在，诊断关闭/开启都通过；另覆盖错误 session、重复归一化 final、close 后 late input 不覆盖正文。

**该回放首次有效运行即绿，没有复现用户 P0。** 六次早期失败都是测试设施（mock default export / Vite URL）错误，不是产品红。不能将本测试称真实 Pi/Desktop E2E 或 P0 红→绿。原 tests 分别验证 host、guard、reducer 与人工 UI 事件，不能证明现场跨层显示；即使新增回放全绿，也不能排除缺失的真实时序/事件或实际窗口布局问题。

## 显式 opt-in 临时诊断

需要主会话先取得用户对**未来一次带诊断构建的启动/重启与人工发送**的许可。本批未执行以下操作，也没有自动关闭当前窗口。当前运行产物未被构建或触碰；新增日志不能追溯已丢事件。

1. 后续经允许构建一次，再由用户/主会话按获准启动方式设置唯一开关 `PUA_MISSING_ASSISTANT_DIAGNOSTICS=next-chat`。不要运行 verify/dev/smoke 来替代此授权。main 只锁定这个进程第一个实际登记的 chat ID；terminal 不绑定；即使目标启动失败也不改绑下一个。先创建第二个 chat 不会让它成为目标。没有修改 Session ID、准入或协议。
2. 仅目标 utility fork 的既有 env option 收到 `PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION=<Desktop ID>`。`next-chat` 不下传，两个诊断键从 Pi 子进程及非目标 utility 环境移除；其它键不变。
3. main 标准输出仅收集以 `[PUA_ASSISTANT_DIAGNOSTIC] ` 开头的行。第一条目标 metadata 中 sessionId 可与目标 `.chat-pane[data-session-id]` 核对。只保留这些诊断行，**不要分享整个 Electron/Pi stderr 或环境**。
4. 在用户允许打开的该窗口 DevTools console，用户主动执行下列代码（不发送 Pi）：

   ```js
   const target = document.querySelector('.chat-pane.active')?.getAttribute('data-session-id');
   if (!target) throw new Error('没有活跃 Chat');
   sessionStorage.setItem('PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION', target);
   ```

   当前诊断模式通过“窗口 → 打开开发者工具”提供显式 opt-in 入口，见 [菜单实现](../src/app/main/menu.ts)；仅 `PUA_MISSING_ASSISTANT_DIAGNOSTICS=next-chat` 启用时显示，普通模式不显示。不新增 IPC、window.desktop 权限或 URL/query 开关，也不自动打开 DevTools。
5. 用户自己向该目标新 chat 发起只要求回复 `PUA_ACCEPTANCE_OK` 的最小提示。回到 ready 后，不以 ready 当成功：检查同 session `.chat-message.assistant .message-body` 是否真正显示 marker。可手动记录 DOM 元素是否存在、textContent 是否包含 marker 的布尔值；不导出完整聊天 DOM。
6. 收集目标 metadata：`worker-received`（收到已解析 Pi event）、`worker-emitted`（尝试发出）、`main-accepted`（parser + resource guard 后）、`main-forwarded`（调用现有 observer 前）、`renderer-received`（pane session filter 后）、`renderer-reduced`（React 提交后的最近 assistant 投影）。后者不是 DOM 可见性证明；React 可批处理多个事件，一次投影不等于每次 reducer 调用。日志名称中的 emitted/forwarded 是同步边界尝试，不承诺 IPC 物理送达。
7. renderer 关闭：`sessionStorage.removeItem('PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION')`。main/worker 的本次采集自行达到 100 条后停止；完全关闭开关需要用户授权下一次不带 env 的启动。没有运行时新增控制 API。每个 main/worker/renderer 实例总计至多 100 条（main 转发 worker 行也计入额度），额度耗尽可能漏掉后面的 final，不能把无日志直接判作丢包；如启动噪音耗尽需重新申请最小采证方案，不自动加额度。

固定 metadata 字段只含 stage/eventType、过滤后的目标 sessionId、messageId、role、有限 block type 集合、marker 布尔。ID 仅 `[A-Za-z0-9_-]` 且最多 128 字符；不记录正文、tool args、附件、错误文本、queue、全 env 或任何历史文件。未知 event type 不记录。target lookup、投影、stdout framing 与日志 sink 异常被隔离；默认关闭不扫描 renderer transcript，不记录任何行，不改变业务事件内容/次数/顺序。

取得红反馈后再按 boundary 排序并提出可证伪根因假设。当前没有产品红，不把协议/关联/guard/DOM 候选强排成已验证解释，不修猜测。

## 未来真实端到端门禁（未落地，待单独授权）

已只读审查 `scripts/smoke-pi.mjs` 与 `smoke-desktop.mjs`：前者是隔离 offline extension UI、`--no-session` 且不请求模型；后者是外部 Fake Pi、真实 Git/clipboard/窗口操作。它们都不是本 P0 的“同 session 持久化 assistant 与 DOM 相等”门禁，不应未经授权运行或把本批回放包装成替代品。

独立真实门禁应显式 opt-in、默认不接 verify/package：独立 userData/项目/session 目录，用户批准的运行时与模型调用；不读取/复制 auth、不扫描其它 Pi history，不关闭已有窗口。由该次会话明确定位唯一 session 文件，仅比较该次 assistant 标记文本与对应 Desktop session 的实际 DOM 正文，在 final→idle 后以及必要切换后仍一致；限定时长、仅清理自身资源，保留脱敏失败边界。具体凭据/模型/隔离办法须用户批准，不在本批偷偷实现或执行脚本。

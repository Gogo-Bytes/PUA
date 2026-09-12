# DesktopResult / Renderer client（有限 vertical）

状态：21 invoke、3 send、1 event 的代码契约已闭合；独立候选 review、提交与真实桌面验收是另外的门禁。本包不代表目标架构完成，也不是助手回复缺失 P0 的修复。

## Interface 与 owner

- `shared/ipc/desktop-api.ts` 的 `DesktopAPI` 保留应用成功值；Conversation/Session event 与 Change Review DTO 分别由同目录 `conversation.ts`、`change-review.ts` 声明。`DesktopBridge` 派生 raw Result，`Window.desktop` 可缺失。旧 `shared/contracts.ts` 及 shared 顶层契约路径已删除，所有调用方直接引用 canonical seam；迁移只改 import 与退休路径门禁，不改类型声明或 wire shape。
- `shared/ipc/desktop-result.ts` 定义 Result、按方法穷尽的成功值 guard 和全部当前 SessionEvent 分支的外层检查。void 在 wire 为显式 `null`，client 还原 `undefined`；picker 的 null、close 的 false、空数组都是成功。缺 value、矛盾分支、非 boolean ok、未知 error kind 或非法 payload 不作成功或旧值 fallback。
- `platform/electron/ipc/registrar.ts` 保持 sender → 主 frame → 精确 URL → tuple parser → Implementation。拒绝 sender 不触发 parser 或资源准备；invoke 的同步/异步异常都编码。合法 handler 成功类型仍是应用值，不把 wire error 搬入业务 core。
- `desktop-errors.ts` 的边缘 Error carrier 保留 Session / Conversation / Review mapper 稳定 code 与原中文 message。明确 sender 拒绝是 authorization；parser 是 validation；业务/普通 Error 是 application；未知对象/不可读 Error 是 internal。requireCurrent 等其它异常不会冒充 sender 拒绝。
- preload 仍是逐方法白名单、单 sandbox CJS，仅 require Electron。event callback 不暴露 ElectronEvent，remover 精确移除原 listener；没有任意 channel 能力。
- `renderer/app/desktop-client.ts` 是唯一生产 global bridge seam。稳定 client 不在模块初始化捕获 bridge；每次请求读取最新 bridge/方法、保持 this。invoke wrapper 不声明 async，raw 同步 throw 同步转换，Promise reject 保持异步 transport。decode 的 application/protocol 错误不会再次包装为 transport。
- App、ChatPane、TerminalPane、GitPanel、ContentView、preferences/sessions 全走 client；Workspace 仍注入应用侧窄 Interface。原 mount-only 订阅、effect deps、session key 常驻、草稿/附件/queue、closure 与 continuation 不提取或优化。

## 错误与订阅生命周期

`DesktopClientError.name = 'Error'`，现有 `String(error)` 和复制/链接文案前缀保留，不剥除 message 内层 `Error:`。只读取真正 Error 的字符串 message，不读取未知对象 message getter、不调用自定义 toString，不携带 stack/cause/request/raw 对象。普通 host message 未做内容秘密识别：本契约限制字段与未知对象泄漏面，不宣称任意 host 文本已经脱敏。

每次订阅捕获创建时 bridge 的 remover，不建 fanout/event bus/replay/global dispose，也不随换桥重绑。取消先 inactive、再 remove；幂等、迟到 callback 不通知 observer。合法 observer 与 remover 抛错保留原身份/同步时序；remove 失败仍 inactive、不自动重试。非法事件同步抛无 raw payload 的 protocol error，不吞掉或交给业务 observer。

三个 PTY send 原样同步提交，不改 await、chunking、ACK 单位、NUL/控制字节或大 paste，不新增限额。main 仍 catch/log/drop；这不是送达确认。

## 测试 Adapter 与 gate 的真实边界

`tests/desktop-bridge-fake.ts` 只把应用 Fake 的成功/异步失败编码成 raw envelope，不调用成功 validator、不 clone 数据；同步 throw 原样发生。各测试保留独立应用 Fake 引用供动态替换，不把 wire 与应用成功值混用。`workspace-preview.tsx` 仅安装此 transport Adapter，场景/数据/文案/视觉不变。它仍是 TEST ONLY，不是 Electron/Pi host。

现有未知对象 Fake 不再以自定义 toString 作正常业务错误：合法错误用 Error 经 envelope 保留文案，未知对象另测固定 fallback 与不执行 getter/toString。晚到 inspection 仍经 client 做外层校验（测试 getter 因而会被 decoder 读取），原 feature active guard 仍阻止发布；不声称校验阶段完全不读取迟到 DTO。

- 真实注册函数 + 内存 Electron ports + source preload + real client + actual App/ChatPane 用户操作测试，另有全 21 方法双向成功/失败、3 send、event 生命周期/畸形输入、动态桥与错误分类测试。Virtuoso 使用真实实现及官方 jsdom layout context，非视觉/滚动几何验收。
- AST gate 拒绝生产 `.desktop`、字面/计算属性、常见解构/解构赋值及局部 window alias；只豁免精确 client 源路径。测试装配在 `tests/`，不能从生产 import。此为有限语法/局部 alias 检查，不是完整 lint、任意 JavaScript 数据流或运行时安全沙箱。
- smoke-ipc / smoke-desktop 仅静态迁移 raw 结果与拒绝断言；transport rejection 不再可冒充业务拒绝。smoke-pi 只有 send/event，不需要结果迁移。未运行任何 smoke。
- 本轮允许的验证仅逐文件审核的纯 Fake/jsdom 白名单（含 worker-protocol）、三个 noEmit、两 preview 类型检查、AST/44 保护与27节点闭包/hash、HEAD archive + 明确 allowlist 的隔离生产/preload/两 preview build 及静态 source/emitted links。当前运行 dist 不写入，产物不执行。

外层 guard 不递归验证 transcript blocks/tool JSON；同版本 mapper 仍是这些嵌套值的信任来源。没有 Electron structured clone/contextBridge、真实 Pi/PTY/Git/fs、浏览器/视觉或生命周期实测。保留现有大 chunk 告警；不运行 verify/dev/package/dist/全量 npm test，不安装依赖。后续删除旧 contracts 入口的架构批次也按用户要求未运行自动测试、build、typecheck、smoke 或应用，仅做静态 read/search/diff 检查。

## 后置项与维护入口

App composition-only/必要 continuation 收口、Preferences 可变引用 alias 修正、剩余 bounds 政策、formatter/完整 lint、生产 UI 统一、完整产品/跨平台发布 gate 均后置。原 Session/Conversation/Preferences/ChangeReview owner 与业务规则、诊断默认关/editMenu、普通模式基本手验事实保持。

设计与维护按 `AGENTS.md` → [目标架构](target-architecture.md) 与 [现行架构](architecture.md)；UI 变更仍须单独读 [ui 指南](../src/renderer/ui/README.md) 与 [生产接入契约](../src/renderer/ui/production-integration.md) 并取得授权。此次读取的技能是三个独立文件：`/Users/gan/.agents/skills/codebase-design/SKILL.md`、`/Users/gan/.agents/skills/domain-modeling/SKILL.md`、`/Users/gan/.agents/skills/writing-for-agents/SKILL.md`；后两者不是 codebase-design 子路径。

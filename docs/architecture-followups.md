# 架构后续问题与重构记录

状态：记录问题，暂不实施重构。

更新时间：2026-10-09。本文记录当前代码审查得出的后续工作，不改变现有产品行为，也不授权自动开始重构。实施前必须重新以代码、测试和 Git 状态校正文档。

## 当前判断

项目的基础工程质量并不差：TypeScript 类型检查、ESLint、边界检查和当前测试均通过。主要问题是异步状态所有权分散，导致一个简单的“发送消息”跨越 renderer、IPC、main、utility worker、Pi RPC 和多套 mapper/reducer。后续重构应收敛状态机，而不是继续增加局部修补。

当前验证基线：`npm run typecheck`、`npm run lint`、`npm test`、`npm run check:boundaries` 和 `npm run check:protected` 已通过；本次 `npm test` 为 92 个测试文件、2811 个测试。

## 已确认的问题

### 1. ChatPane 负责过多状态和副作用

`src/renderer/features/conversation/ChatPane.tsx` 同时拥有 session 启动、首条消息、草稿 revision、附件、发送/停止/Fork、模型加载、extension dialog、统计、滚动和事件订阅。`startedRef`、`initialSentRef`、`sendingRef` 等 ref 组成了 UI 内部的隐式并发控制。首条消息启动问题已经导致最近一次修复显著扩大该组件和对应测试的体积。

后续方向：将 UI 收敛为意图提交和事件投影；把启动、ready、send、stop、exit、waiting-input 的权威状态放入 application/worker state machine。可拆出 composer、transport、runtime controls、scroll 和 transcript presentation。

### 2. Pi RPC worker 是多职责全局脚本

`src/app/workers/pi-rpc.worker.ts` 同时处理子进程、RPC pending/timeout、JSONL、Pi command、snapshot、stream、tool、extension UI、fork/clone、诊断和 shutdown，并通过模块级可变变量协调生命周期。

后续方向：拆出 transport、Pi session gateway、conversation event projector、snapshot loader 和 worker lifecycle；worker 只负责组装和转发。

### 3. Fork 关联依赖文本匹配

`withForkEntries` 通过用户消息文本和顺序寻找 Pi entry id；renderer reducer 又维护了一份相近逻辑。重复消息、规范化文本、附件或历史顺序变化都可能造成错误关联。

后续方向：在 Pi history normalization 阶段保留 entry id，并让消息模型携带稳定的 Pi identity，删除文本猜测。

### 4. Domain、IPC、renderer 存在重复 DTO

`Conversation*`、`Chat*` 和多组 mapper/reducer 对同一消息、工具、队列和 runtime state 进行重复表达。字段变更需要同步多个层次，容易造成协议漂移。

后续方向：明确 domain model、wire DTO、view model 的边界，每类只保留一个 canonical 定义；mapper 只做边界转换。

### 5. 附件 wire 暴露了文件路径

Conversation domain 使用 token 和 source id 管理附件，但 `shared/ipc/conversation.ts` 的 `ChatAttachment` 仍包含 `path`。这与目标架构中“renderer 只持有边缘生成的附件 token，真实路径留在 main registry”的约束不一致。

后续方向：renderer DTO 只保留 id、名称、类型、大小和预览；文件路径只留在 main/adapter。

### 6. 缺少稳定 ID 时使用随机值

`src/platform/pi/rpc/chat-normalize.ts` 在 tool call 缺少 Pi id 时使用 `Math.random()`。这会破坏重放、测试稳定性和 tool result 关联。

后续方向：使用基于输入位置和消息身份的确定性 fallback，或拒绝无法关联的 tool call。

### 7. 业务错误在 UI 层退化为字符串

多个调用方直接 `catch (error) { onError(String(error)) }`。会话未 ready、Pi 不可用、ACK 未知、附件过期和用户输入错误无法稳定区分，后续 agent 很难判断应该修改哪一层。

后续方向：定义稳定的 application error code，由 renderer 统一映射为用户文案。

## 推荐实施顺序

1. 先画出并测试 Conversation/Session 的状态转移和所有权。
2. 把首条发送和启动握手从 ChatPane 移到 application/worker。
3. 拆分 worker 的 transport、gateway、projector 和 lifecycle。
4. 让 history normalization 保留 Pi entry identity，移除文本匹配。
5. 收敛 DTO 和错误码，再处理附件路径边界。
6. 用少量时序集成测试覆盖启动发送、stop/send race、进程退出、旧事件、重复文本 fork 和附件失效。

## 暂不处理的事项

本记录不要求现在改动产品、IPC channel、Pi 协议或目录结构。任何实施批次都必须先重新阅读 [目标架构](target-architecture.md)，核对当前代码和测试，并按阶段单独提交。

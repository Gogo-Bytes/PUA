# PUA 目标架构

状态：**目标设计，进程入口与平台 Adapter 目录边界、shared/ipc 契约边界、首批 IPC / 验证基线、Session 核心及 Conversation send/attachment、runtime stop/activity/waiting、stream/tool/history、Change Review、Preferences、用户安装 runtime/environment 与 renderer Workspace/领域 presentation 路径有限落地，非全量重构完成**。本文是后续架构重构、新模块设计和代码评审的规范来源；当前已实现行为仍以代码、测试、[现行架构](architecture.md) 和 [原生对话设计](native-chat-design.md) 为准。

本批已集中 Desktop IPC channel/DTO/schema、统一 main sender → parser seam、打包 sandbox preload，并建立包含 tests/fixtures 的 TS/TSX 类型检查及隔离 IPC/生命周期 smoke 的 `verify`（`.mjs` fixture 未被 TypeScript 检查）。发布入口经 verify 只构建一次；生命周期当前仅 macOS 验证，其他平台明确阻塞发布，不代表 release matrix 完成。首批当时兼容 Promise 成功值/异常；后续 [DesktopResult/client 有限 vertical](desktop-client-contract.md) 已实现结构化结果与统一 renderer seam，旧 `contracts.ts` 与其余 shared 顶层契约入口也已删除，Desktop、Conversation 与 Change Review DTO 由 `shared/ipc` 单一声明。未设上限的字符串策略仍未实施。阶段 0 的 formatter/完整 lint、完整产品 smoke、preview export 清理、阶段 2 完整桌面验收与完整阶段 3–5 均未完成；阶段 3 仅 send/attachment、runtime stop/activity/waiting 与 stream/tool/history 有限落地，不能将首批有限落地视为 Spec P1 全完成；renderer 已按用户授权条件解冻，生产 App/Workspace 状态及 Conversation/Terminal/Change Review/Workspace presentation 路径已有限归位；原 `ui`、`modules`、44 项组件/demo 保护集合及视觉参考依赖闭包原位原字节保留，正式 UI 未替换，不删除后续 UI 收敛目标。具体范围与验证限制见 [现行架构的首批状态](architecture.md#desktop-ipc-首批重构有限落地)。

有限收尾首包现完成 strict Pi response 代码与纯验证：pending command 关联、严格 boolean/error、clear 两条 string[] 和既有 handshake 外层契约，真实 Fake worker→main token/renderer 草稿失败链闭合。这是安全契约修正，不是未知助手缺失 P0 修复。实际兼容来源、验证限制和累计提交依赖见 [Strict Pi 收尾](architecture.md#strict-pi-response有限协议收尾)。strict Pi checkpoint 已提交为 `e709f4d`。后续 DesktopResult/client 的有限代码契约现已闭合，范围与验证限制见 [契约说明](desktop-client-contract.md)；该 vertical 已提交为 `e7b5fa8`。App 必要 continuation 已按下述阶段 4 有限收口并提交为 `1d9c491`。其后的进程边界归位只完成源码移动、import/URL/config/静态门禁与文档更新；再后的 contracts 退休批次只迁 canonical type import、删除兼容入口并增加静态门禁；renderer 领域 presentation 批次只移动文件、拆分既有 helper 职责并更新公开入口；shared 边界批次将剩余跨进程 DTO/验证/诊断 codec 归入 `shared/ipc`，并将 renderer-only scope 投影归入 Change Review feature。四批均按用户要求未运行自动测试、构建、typecheck、smoke 或应用。Preferences 可变引用 alias 行为修正及门禁、bounds/UI/真实验收/发布目标均未完成。

## 1. 目标与适用范围

PUA 是 Electron + React/TypeScript 桌面应用，通过用户本机 Pi 的 RPC 或 PTY 提供原生对话与兼容终端。目标架构需要同时满足：

1. Electron 的进程、权限和故障隔离一眼可见并可自动检查；
2. 业务能力按领域模块组织，而不是长期平铺在 `main`、`renderer` 或模糊的 `modules` 目录；
3. Pi、PTY、Git、文件系统和 Electron 都位于可替换的 Adapter 后；
4. 核心会话规则脱离 Electron、React 和协议对象，可独立测试；
5. UI 状态、应用工作流和领域状态拥有明确归属；
6. 模块提供深 Interface，隐藏协议、进程、并发和恢复细节；
7. 类型检查、测试、构建和发布通过统一门禁验证。

本文规范生产架构，不规定视觉稿，也不授权自动开始重构。

## 2. 架构决策

采用以下组合，而不是单一框架模板：

- **进程优先的安全边界**：main、preload、renderer、utility worker 物理隔离；
- **模块化单体**：按 Workspace、Session、Conversation、Change Review、Preferences 组织业务；
- **Ports & Adapters**：业务 Interface 与 Electron/Pi/Git/文件系统实现分离；
- **选择性 DDD**：只在具有业务不变量的 Session、Conversation 等核心模块使用领域模型；
- **Feature-first Renderer**：页面和交互按功能归位，通用 UI 保持无业务依赖。

DDD 不覆盖 Button、Dialog、CSS、动画、BrowserWindow、JSONL decoder 等纯展示或基础设施代码。不得为了目录对称而创建空层、单实现 Interface 或只转发调用的浅 Module。

## 3. 系统边界与依赖方向

```text
┌──────────────── Renderer Process ────────────────┐
│ React App → Feature Presentation → Desktop API   │
└────────────────────────┬─────────────────────────┘
                         │ typed IPC DTO
┌──────────────── Preload Process ─────────────────┐
│ contextBridge：最小能力白名单、无业务决策          │
└────────────────────────┬─────────────────────────┘
                         │ validated IPC
┌────────────────── Main Process ──────────────────┐
│ IPC adapters → Application use cases → Domain    │
│                         ↑ Ports ← Infrastructure  │
└───────────────┬───────────────────┬───────────────┘
                │                   │
       ┌────────▼────────┐  ┌──────▼──────────┐
       │ RPC utility     │  │ PTY utility     │
       │ Pi RPC Adapter  │  │ Terminal Adapter│
       │ Conversation core│ │                 │
       └────────┬────────┘  └──────┬──────────┘
                └──────────┬────────┘
                           ▼
                     用户本机 Pi
```

强制依赖规则按进程分别定义：

```text
Main:     IPC Adapter → Application → Domain
                         Application → Port ← Infrastructure Adapter
Renderer: Feature Presentation → Desktop Client Facade → shared/ipc
Preload:  contextBridge Adapter → shared/ipc
Worker:   Pi Adapter → Conversation Application → Domain
                       Application → Port ← Pi/clock Adapter
          Pi/PTY Adapter → shared/ipc worker protocol
```

`modules/*` 是协议无关业务核心，执行位置由进程 composition 决定：Session 与 Conversation send/attachment 在 main；单会话 Conversation runtime 允许在 utility worker 内持唯一实例。worker 执行不授权 core 引入 Node、Pi、Electron 或 shared wire，也不将附件/Session 权威复制过去。renderer 通过 Desktop Client Facade 和 IPC 使用 application use case，不能直接 import 业务核心。Renderer 可以拥有纯 view model、selector 和 projection reducer，但它们只解释 shared IPC DTO，不成为第二份领域规则。

禁止的生产依赖：

```text
domain -/-> React | Electron | Node | Pi RPC | Git
application -/-> React | Electron concrete APIs
shared/ipc -/-> React | Electron | Node
renderer -/-> modules | main | preload implementation | utility workers
ui -/-> feature | window.desktop | Pi | Git | filesystem
```

`shared` 只保存跨进程 DTO、事件、channel 和运行时 schema；它不是通用工具杂物间，也不是领域模型的默认位置。

## 4. 目标目录

目录按需创建。小模块可以省略没有价值的层；不得为匹配树形图创建占位文件。

```text
src/
  app/
    main/
      bootstrap.ts
      create-window.ts
      lifecycle.ts
      menu.ts
    preload/
      desktop-api.ts
    workers/
      pi-rpc.worker.ts
      pty.worker.ts

  modules/
    workspace/
      domain/
      application/
      ports/
      infrastructure/
      index.ts
    sessions/
      domain/
      application/
      ports/
      infrastructure/
      index.ts
    conversation/
      domain/
      application/
      ports/
      infrastructure/
      index.ts
    terminal/
      application/
      ports/
      infrastructure/
      index.ts
    change-review/
      domain/
      application/
      ports/
      infrastructure/
      index.ts
    preferences/
      domain/
      application/
      ports/
      infrastructure/
      index.ts

  platform/
    electron/
      ipc/
      utility/
      dialogs/
      clipboard/
      shell/
    pi/
      rpc/
      runtime/
      process/
    process/
    pty/
    git/
    filesystem/

  renderer/
    app/
      App.tsx
      AppProviders.tsx
      desktop-client.ts
      global-shortcuts.ts
    features/
      workspace/
      sessions/
      conversation/
      terminal/
      change-review/
      preferences/
    ui/
      primitives/
      layout/
      feedback/
      theme/
      icons/

  shared/
    ipc/
      channels.ts
      schemas.ts
      desktop-api.ts
      events.ts
```

测试与生产结构对应：

```text
tests/
  modules/
    workspace/
    sessions/
    conversation/
    change-review/
  platform/
    electron/
    pi/
    git/
  renderer/
    features/
    ui/
  integration/
  smoke/
  fixtures/
```

若保留顶层 `scripts/` 执行 smoke，测试场景实现应拆分为可独立定位的用户旅程，避免一个超长串行脚本承载全部产品验收。

## 5. 领域上下文与所有权

### 5.1 Workspace

拥有：

- host 提供的完整 cwd 项目标识、会话分组与最近项目 snapshot 的展示；最近项目权威属于 Preferences；
- 项目与会话的视图关系；
- 当前项目、当前会话和每项目最后活跃会话；
- 工作区布局偏好。

不拥有会话进程生命周期、Preferences current/recents、对话消息或 Git 命令执行。当前首 slice 在 `renderer/features/workspace`：纯 selection Module 无 React/shared/Node 依赖，hook 持唯一窗口内投影与选择；没有新增后端 Workspace 空层。布局偏好仍是后续目标。

### 5.2 Session

核心领域。拥有：

- Session 身份、类型和生命周期；
- Process Status，以及它与 Conversation 所拥有的 Agent Activity 之间的明确区分；
- new / continue / resume 启动语义；
- Chat 并行、恢复互斥、Terminal 独占等所有权策略；
- 关闭准入和所有权释放时机。

`SessionCoordinator` 负责编排 use case；`SessionOwnershipPolicy` 以显式结果表达允许或拒绝及原因；具体 utility process 位于 Adapter。

### 5.3 Conversation

核心领域。拥有：

- Message、Block 和 Tool Execution；
- prompt / steer / follow-up 的产品语义；
- steering/follow-up queue；
- streaming 合并和最终消息权威性；
- Extension UI 等待；
- 附件登记、发送消费和失效语义。

Pi RPC 原始对象、JSONL、request id 和 utility message 不得泄漏到此上下文的调用方。

### 5.4 Terminal

支撑能力。拥有兼容终端的应用操作和展示接口；PTY、xterm、键盘协议和输出背压属于其 Adapter/Presentation。Terminal 服从 Session 上下文定义的独占策略，不复制该规则。

### 5.5 Change Review

拥有 Repository Snapshot、Change Set、Changed File、Diff Scope 和只读审查语义。Git 命令、路径解析和输出截断位于 Git Adapter。

### 5.6 Preferences

拥有桌面外壳的 current、保存成功发布与桌面最近创建项目。当前 `PreferenceValues` 独立于 wire；IPC/disk 的结构校验与兼容归一化仍由冻结 shared schema 单一负责，core 不复制校验政策。JSON 默认值/default spread 是磁盘兼容边缘规则，不是额外 domain 层。Pi 的模型、凭据、信任、技能、工具和扩展配置不属于 PUA Preferences。

## 6. 统一语言

后续代码、测试和文档使用以下术语：

- **Project**：由规范化绝对 `cwd` 标识的本机工作目录；显示名不是身份。
- **Workspace**：当前窗口内项目、会话选择和布局形成的桌面工作状态。
- **Session**：PUA 托管的一次 Pi Chat 或 Terminal 运行槽位及其生命周期。
- **Chat Session**：通过 Pi RPC Adapter 驱动的结构化会话。
- **Terminal Session**：通过 PTY Adapter 驱动的兼容会话。
- **Process Status**：`starting | running | exited`，只描述托管进程。
- **Agent Activity**：`idle | responding | compacting | retrying | waiting-input`，只描述 Pi 业务活动。
- **Conversation**：Chat Session 中可呈现的消息、工具、队列和交互状态。
- **Runtime**：可启动用户 Pi 的可执行文件、参数与环境解析结果。
- **Adapter**：在 Seam 上满足业务 Interface 的具体实现，例如 Pi RPC、PTY 或 Git。
- **Snapshot**：某一时刻的只读观察结果，不承诺与后续读取原子一致。

避免使用宽泛的 `Manager`、`Service`、`Helper`、`Common`、`Module` 作为无法表达所有权的目录或类型名称。仅当对象确实承担协调职责时使用 `Coordinator`。

## 7. Module 与 Interface 设计

每个 Module 对外只暴露一个稳定入口 `index.ts`，内部文件不作为跨模块依赖路径。Interface 包含类型之外的顺序、不变量、失败模式和资源语义。

设计要求：

1. Interface 隐藏实现复杂度，而不是逐方法镜像 Electron 或 Pi；
2. caller 和测试通过同一个 Interface；
3. 依赖由 composition root 注入，Module 内不自行构造平台实现；
4. 操作返回显式结果或领域错误，避免调用方解析中文错误文本做控制流；
5. 只有存在真实变化点时才引入 Port；一个永远不会替换、没有测试替身需求的实现保持内部实现；
6. 跨模块只交换稳定 ID、值对象、命令、结果或领域事件，不共享可变内部对象。

示意 Interface，不是要求照抄方法名：

```ts
interface SessionApplication {
  create(command: CreateSession): Promise<CreateSessionResult>;
  start(sessionId: SessionId): Promise<void>;
  close(sessionId: SessionId): Promise<CloseSessionResult>;
  observe(listener: (event: SessionEvent) => void): Unsubscribe;
}

interface SessionProcessPort {
  start(input: StartSessionProcess): Promise<RunningProcess>;
  close(process: RunningProcess): Promise<void>;
  observe(process: RunningProcess, listener: ProcessEventListener): Unsubscribe;
}

interface ConversationRuntimePort {
  send(sessionId: SessionId, command: ConversationCommand): Promise<void>;
  stop(sessionId: SessionId): Promise<RecoveredQueue>;
  respond(sessionId: SessionId, response: ExtensionResponse): Promise<void>;
}
```

`SessionCoordinator` 是 process handle 和 lifecycle 的唯一协调方；Conversation application 只通过 session-scoped `ConversationRuntimePort` 发送业务命令。Adapter 的归一化事件进入 Conversation projection；其中 Process Status 更新 Session，Agent Activity、消息、工具和队列更新 Conversation，二者只在面向 renderer 的 Session View 中组合。跨上下文协调由 main composition/application facade 完成，上下文不得互相引用内部实现。

不要让 Runtime Port 暴露任意 `Record<string, unknown>` command 给 renderer；只有 Adapter 内部可以理解 Pi 原始协议。

## 8. 状态所有权

| 状态 | 唯一所有者 | 说明 |
|---|---|---|
| 会话准入、互斥、Process Status、关闭 | Session domain/application | renderer 只展示结果 |
| utility/child process handle | Session runtime Adapter，由 SessionCoordinator 协调 | 不进入 domain 或 IPC DTO |
| Agent Activity、消息、工具、队列 | Conversation state | Session View 只持派生投影；最终消息和事件顺序遵守协议不变量 |
| 当前项目/会话选择、每项目 remembered selection | `renderer/features/workspace` 的唯一 hook state | 纯 selection Module 决策；不由 App 或单个 Tab 持第二份 |
| 每会话草稿 | Workspace input presentation 持文本；ChatPane 持 revision/ref 与附件 | 以 session id 索引，切换不卸载；后续 presentation 提取不改变提交身份语义 |
| 附件 token / 文件路径 | Conversation application / main-side Attachment Adapter（分别拥有） | 目标是 renderer 只持 opaque id 和展示元数据；当前既有 `ChatAttachment.path` 仍返回 renderer，发送授权由 main 按 session token 查登记，不以路径不可见为保证 |
| 命令面板 open/query、按 session 的命令缓存与展示投影 | `renderer/features/command-palette` 的 App 挂载级 hook | Chat 来源仍是 ChatPane 的 RPC snapshot；选择仅经 Workspace input 插入草稿或 Terminal handle，不执行 |
| panel 展开、tooltip、输入框高度 | React 局部 UI | 不进入 domain |
| theme preference | main Preferences；renderer `features/preferences` 仅持挂载局部编辑草稿 | desktop presentation boot 是保存结果投影；实际 resolved theme 应用仍由原 `useTheme` 持有 |

同一状态只能有一个权威所有者。派生状态通过 selector 计算；跨进程副本必须标明 snapshot 或 event projection，不能形成双写。

## 9. IPC 与桌面安全

### 9.1 Contract

IPC channel、request、response、event 和运行时 schema 必须来自 `shared/ipc` 的单一来源。TypeScript 类型不替代运行时校验。

每个 handler 必须：

1. 验证 sender、主 frame 和页面来源；
2. 在 main IPC seam 校验所有不可信参数；
3. 调用 application use case，而不是直接包含业务规则；
4. 返回结构化成功/错误结果；
5. 对路径、数量、大小、枚举和字符串实施明确边界。

preload 按方法暴露最小能力，不能暴露 `ipcRenderer`、任意 channel 发送能力或 Node 对象。

### 9.2 必须保留的安全基线

- renderer 使用 sandbox 和 context isolation；
- renderer 无 Node integration，并通过 CSP 禁止非预期外部 `connect-src`；
- 禁止非预期导航、新窗口和权限请求；
- HTTP(S) 外链经 main 校验后打开；
- Markdown 不执行 raw HTML，不自动加载远程图片；
- 附件由 main 文件选择器登记为 opaque id；
- PUA 不读取或回传 Pi `auth.json` / `trust.json`；检测到项目资源时必须让用户明确选择沿用 Pi 决定、本次 `--approve` 或本次 `--no-approve`；
- Chat 启动参数必须拒绝破坏 RPC 协议、Session 所有权或 trust 所有权的 CLI 参数；其他允许参数仍保持用户 Pi 语义；
- utility process 是故障与生命周期隔离，不宣称是权限沙箱。

## 10. 进程与协议不变量

重构必须保留现有测试覆盖的行为：

1. JSONL 使用 LF framing、跨 chunk UTF-8 decoder 和入站大小限制；
2. delta 批处理在 `message_end` 前 flush，最终 message 为权威值；
3. Tool Execution 以 `toolCallId` 关联，累计 partial result 使用替换语义；
4. `agent_settled` 决定完全空闲，Extension UI waiting 独立于 Agent Activity；
5. stop 先恢复 queue，再 abort；失败不静默丢失已恢复文本；
6. pending request 有数量、背压和超时边界，未知接收状态的命令不自动重放；
7. 关闭等待 utility/child process tree 清理后才释放 Session 所有权；
8. Chat 新会话可并行，恢复与 Terminal 独占规则由唯一 policy 实现；
9. 应用关闭先原子封锁 create/start；任何创建流程经过 `await` 后、预留 Session 所有权前必须重新检查准入，race test 必须覆盖该时序；
10. Pi 版本不兼容必须明确失败，不解析 ANSI 静默降级；
11. renderer 崩溃和应用退出必须触发全部托管会话清理。

详细限额和协议行为以 [原生对话设计](native-chat-design.md) 及可执行测试为准；本文不复制易漂移的具体数值。

## 11. Renderer 与 UI

### 11.1 分层

```text
renderer/app             组合 Provider、Desktop Client Facade、全局路由与窗口级快捷键
renderer/features/*      业务 Feature UI，只调用 Desktop Client Facade
renderer/ui/primitives  无业务语义的通用交互组件
renderer/ui/layout      通用布局能力
renderer/ui/feedback    通知、状态和错误呈现
renderer/ui/theme       token、主题和 reduced-motion
```

生产只保留一套 Icon、Dialog、Theme 和 token。预览样例、fixture、Replay 控件和测试文案位于测试预览，不从生产 UI barrel 导出。

### 11.2 UI 状态规则

- 业务 Feature 优先受控状态；可复用 UI 只持有完成交互所需的局部状态；
- 草稿、附件、Session 选择和 panel 偏好不得因视觉组件替换改变所有权；
- 异步操作提供 pending、防重复、失败和卸载行为；
- 键盘、IME、焦点恢复、reduced-motion 和窄窗口行为是 Interface 的一部分；
- Feature 文案使用统一语言；若决定多语言，再引入资源层，不提前抽象空 i18n 框架。

### 11.3 样式规则

- 源码保持可读格式，不提交压缩式 CSS 或数千字符 JSX 单行；
- semantic token 是颜色、间距、层级和 motion 的来源；
- Feature 可以拥有局部样式，但不能复制 primitive 状态体系；
- 动画不承担业务完成条件；关闭、禁用和 inert 等语义状态立即生效；
- 生产 bundle 使用按能力动态加载控制 Markdown、高亮和 Terminal 等大依赖。

## 12. 测试与质量门禁

测试金字塔按风险而不是文件数量组织：

1. **Domain tests**：Session policy、状态转换、队列与附件不变量；
2. **Application tests**：使用 Fake Adapter 验证 use case 编排、失败和补偿；
3. **Adapter contract tests**：Pi RPC、PTY、Git、文件系统、IPC schema；
4. **Renderer component tests**：真实 Feature Interface、键盘、IME、焦点和异步行为；
5. **Electron integration tests**：sandbox、preload、窗口、IPC、文件选择与进程清理；
6. **Product journeys**：首次启动、创建/恢复/停止/关闭、Git 审查、Terminal fallback；
7. **Release matrix**：macOS、Windows、Linux 的安装、启动、升级和卸载。

统一门禁至少包含：

```text
format check
lint + import-boundary rules
main typecheck
renderer typecheck
test/fixture TS/TSX typecheck
unit + component tests
production build
Electron smoke
```

`package` 和 `dist` 必须依赖适合发布阶段的统一 `verify`，而不是只依赖 Vite 转译。CI 记录命令、平台和 commit；文档不手工维护会漂移的测试数量。

## 13. 迁移策略

允许大型重构，但实施必须保持可验证的增量。禁止只移动目录却保留原耦合，也禁止在同一步同时重写协议、领域规则和视觉系统。

### 阶段 0：冻结事实

完成条件：

- 当前行为、已知限制和关键测试清单可定位；
- 工作区用户改动已识别并保留；
- 建立统一 `verify` 和测试 TypeScript 配置；
- 建立 formatter、lint 和 import-boundary 规则；
- 确认 `renderer/ui` 是唯一目标设计系统，清除 preview-only export。

### 阶段 1：建立 IPC 单一来源

完成条件：

- channel、DTO 和 schema 集中；
- preload 与 main 不再分别手写不受检查的 channel；
- 所有 main handler 在 seam 完成运行时校验；
- renderer 行为和安全测试保持通过。

### 阶段 2：提取 Session 核心

当前：`modules/sessions` 已落地纯 `SessionOwnershipPolicy`、`SessionCoordinator` 与 ID 寻址 lifecycle Port，main-side process adapter 隐藏 utility/PID/pending/附件物理资源。采用同步 prepared `create`，使异步 cwd 检查后的最终准入、预留及材料登记成为无 await/无外部通知的原子段；§7 Promise 签名仅为目标示意。cleanup 确认成功前不释放，失败 sticky。`SessionInfo` 与 activity 留在边缘映射，core 不引 shared DTO。

**阶段 2 代码/纯测试完成；桌面生命周期待用户人工确认，完整完成条件未满足。** 本轮用户禁止应用及替代启动自动化，未运行 lifecycle smoke/verify，纯 build 的静态路径检查不等同 Electron 验收。视觉参考 UI/modules/组件预览继续保护；renderer 当前条件解冻范围见阶段 4。后续 Conversation 子阶段见阶段 3。`main/sessions.ts` 已由 `app/main/composition.ts` 的唯一实例装配、独立 create/附件用例与 `platform/filesystem/session-preparation.ts`、`app/main/session-mapper.ts` 替代并删除；main 直接消费 typed core/Terminal，未叠加 facade。实际所有权与验证范围见 [现行架构](architecture.md#session-核心有限提取阶段-2-代码与纯测试)。

完成条件：

- 所有权、互斥、启动和关闭规则可在无 Electron 环境下测试；
- `SessionCoordinator` 不读取文件、不解析 RPC、不操作 React；
- Chat/Terminal process Adapter 通过明确 Port 接入；
- 应用关闭先封锁 create/start，且创建流程所有 `await` 后在预留所有权前复查准入；对应 race test 通过；
- 生命周期和进程清理 smoke 保持通过。

### 阶段 3：提取 Conversation 与 Adapter

当前完成三个有限代码子阶段：main-side send/attachment 独占附件预算/token/登记串行与单发送/确认消费；worker-scoped runtime 独占 stop、underlying activity/observed、queue/status/widget 与 Extension dialog/waiting/answer。host 只映射本 slice 的 raw 输入、DTO、requestId 并提供 transport/clock/deadline；旧 activity/runtimeState/dialog owner 与 clear→abort 编排已删除。Session 生命周期、附件资源职责、外部 IPC 与 renderer 不变。worker-scoped `ConversationStreamApplication` 另独占 stream/tool/final/历史关联，与 runtime 并列且共同失效；host 原 ledger/批次/merge 与 normalizer 关联循环已删除。typed worker envelope 与 Terminal 窄 Interface 已在后续有限落地（见现行架构 Worker 小节），原 Sessions 的创建/DTO/装配职责已在后续 composition 子批分离、旧文件删除；不声称完整阶段 3。仅静态、纯 Fake 单测与纯 build，未执行原生对话/桌面验收。规则 owner、失败路径修正与旧路径删除条件见 [stream 当前状态](architecture.md#conversation-streamtoolhistory-子阶段阶段-3-未完成) 和 [runtime 当前状态](architecture.md#conversation-runtime-子阶段stopactivitywaiting阶段-3-未完成)；当前 composition 状态见现行架构。

完成条件：

- Pi 原始 RPC 类型不越过 Adapter；
- streaming、tool、queue、Extension UI 和 attachment 规则有独立测试；
- renderer 只消费 Conversation projection 和 application command；
- 原生对话完整 smoke 保持通过。

当前 worker 双向 union、边缘 parser 与 Pi-only worker mapping 已闭合，main 不再构造 raw prompt/image content/rename command；Terminal 由原 process Adapter 直接实现窄 Interface，main 通过 composition 的 `terminal` 引用调用，无新增浅 application class。event guard 仅覆盖 tag/id/control/外层容器，不是递归 transcript schema；缺 ID 不合成回复，有关联畸形消息终结本次 pending。Session 唯一互斥/清理后释放与所有既有 runtime/stream 不变量不变。`sessions.ts` 后续已按上述职责真实分离并有替代 Fake 回归，旧入口 import 清零；这不以 facade 删除代替桌面验收。仅静态、显式 Fake、纯 build；原生/桌面验收仍待用户人工确认。

### 阶段 4：按 Feature 重建 Renderer

当前 App 必要工作流归属已有限收尾：renderer composition root 已从旧 `renderer/App.tsx` 迁至 `renderer/app/App.tsx`，旧路径删除且无兼容转发；App 仅 JSX/owner 连接、无业务窗口快捷路由与 inspector 纯 layout，无直接 host 请求、Promise continuation、draft/handle Map 或 create/rename 实现。`app/useWorkspaceComposition` 只组装真实 owner，无镜像 state、effect/ref 同步桥或整 App 改名容器。该纯路径迁移按用户要求未运行自动测试、build、typecheck、smoke 或应用，只完成静态 read/search/diff 检查。此为 composition-only 的必要职责完成，不要求局部展示无 state，也不表示下列阶段 4 全部完成条件已满足。

`app/useDesktopPresentation` 持窗口 boot/error/Settings open 和 refresh/publish，复用 useTheme；`features/session-launch/useSessionLaunchController` 持 context/defaults/create continuation，原 mount-local form/inspection/trust controller 保留；`features/workspace/useSessionPresentation` 与原样迁入的 RenameDialog 持 rename 提交身份/回写和 openProject。`useSessionInput` 持按 ID 草稿、活 TerminalHandle registry、search 与命令/引用路由；原 `useWorkspace` 仍唯一拥有 sessions/selection/events/close。palette 与 Settings draft 原 owner 不变，所有跨 feature caller 仍经 index。

create 的 add → close/reset → hide search → fire-and-forget refresh、rename 提交时旧 identity、await-close 最新选择及同 continuation 草稿删除、附件旧目标/当前 registry、snapshot append、palette 正常插入才 reset、search 保留与 focus/media/IME/keyboard 注册顺序均保留。ChatPane revision/附件/消息、TerminalPane xterm lifetime、GitPanel 局部状态与 session.id panes 常驻语义不变；这些领域 presentation 及 reducer/helper 已在后续纯路径批次迁入 `features/{conversation,terminal,change-review,workspace}`，旧顶层路径删除且跨 Feature 调用经 index。backend Session/Conversation/Preferences 权威不迁 renderer。真实调用图、callback 稳定性与保留的异步局限见 [App composition 当前状态](architecture.md#app-composition窗口工作流归位有限代码收尾)。

用户条件解冻只授权生产架构职责归位，不是视觉整合：原 ui/modules、44 项保护集合、27 节点视觉 demo 原字节及边闭包保留；辅助 workspace-preview 的 fixture/config/行为不改，composition-root 归位时仅更新 App import 路径。后续领域路径归位批次同样不修改这些范围，并按用户要求不运行自动测试、build、typecheck、smoke 或应用，只做静态检查。顶层 `ContentView.tsx` 暂作 Conversation/Change Review 共享 presentation seam；生产 UI/Theme/Icon/Dialog 收敛、真实桌面/原生对话与跨平台验收仍未完成。

完成条件：

- `App.tsx` 只承担组合，不拥有各 Feature 工作流；
- Workspace、Session、Conversation、Terminal、Change Review、Preferences UI 各自可定位；
- 旧/new Theme、Icon、Dialog 和布局体系完成收敛；
- 草稿、附件、后台事件、滚动和焦点无回归。

### 阶段 5：Change Review、Preferences 与发布治理

Change Review 代码与纯验证已有限闭合：`modules/change-review` 独占 scope、最新 snapshot destination 成员准入与 tracked/untracked 选择；两个语义 Port 后的 `platform/git/review-adapter.ts` 保留命令/parser/clock、路径与 descriptor 安全、原单位截断和错误。IPC edge 映射独立值/稳定业务失败到冻结 DTO/中文异常，shared scope helper 只作 renderer projection，并以矩阵对照约束。snapshot 非事务，无缓存/锁/重试。旧 `main/git.ts` 与旧 import 已删除，retired build 清单在前八条上只加 git.js/map。实际白名单 Fake/源码 golden、类型/AST/冻结及纯 build 静态证据见 [Change Review 当前状态](architecture.md#change-review规则与-git-adapter-有限提取)。

Preferences 后续已有限提取：`modules/preferences` 独占 current、owned recents 与成功发布，`platform/filesystem/preferences-storage.ts` 仅持 JSON/fs/串行 IO queue，无第二 current。main 保留 runtime/bootstrap DTO 与创建后写失败的 Session close/unwrap 补偿；窄 completion 回调保留 publish→bootstrap 和 write failure→close 的 continuation。shared schema 仍在 IPC/disk 边缘，默认 JSON merge、同步校验/调用时 validated snapshot 与既有可变引用局限均保留；queue 不给并发 save/create 提供事务、锁或全局线性化。旧 `main/preferences.ts`/imports 已删除，retired 清单在前十项上只加 preferences.js/map。实际纯 Fake/golden 与静态证据见 [Preferences 当前状态](architecture.md#preferences桌面状态与磁盘-adapter-有限提取)。用户安装定位/环境已有限归位 `platform/pi/{runtime/discovery,process/environment}.ts`，home expansion 在 `platform/filesystem/expand-home.ts`，Chat 参数 policy 在现有 main 创建边缘；旧 `main/runtime.ts` 已退休，无 Runtime/Workspace 空业务层。resource/preparation 本体后续已归位 `platform/filesystem/{project-resources,session-preparation}.ts`，旧 main 源/imports 删除，复用 expand-home；扫描/异步准备与 app 的 UUID/reserve/register/open 顺序不变，无通用 FS 或空 Workspace 层。Workspace 真实状态现有限收归 renderer feature，未新增后端 Workspace；当前状态见阶段 4。其余 platform/worker、renderer/UI 与发布治理仍未完成；真实 Git/fs、桌面/原生对话、跨平台发布与原 browser 红项未运行、未验收。不是阶段 5 完成。

完成条件：

- Git 和 Preferences 通过 application Interface 使用；
- 测试目录与新模块对应；
- CI 和目标平台 release matrix 建立；
- README、现行架构和本目标文档与实现状态同步。

每阶段结束都应删除被替代路径和兼容胶水。迁移代码只有明确下一阶段和删除条件时才允许存在。

最新手工验收只确认普通模式粘贴、连续对话与切换显示；原助手回复缺失 P0 未定位，诊断/source 回放未复现不构成修复，也无 a4fb717 前健康基线。附件/queue/stop/Terminal/设置/清理/发布全矩阵仍欠；此前 filesystem 归位批次不操作运行应用、不改 renderer/demo/诊断/menu/核心政策；当前 Workspace 条件解冻范围见阶段 4，完整事实见 [filesystem 当前状态](architecture.md#project-resources--session-preparation有限-filesystem-归位)。

## 14. 当前文件到目标位置的指导映射

| 当前区域 | 目标职责 |
|---|---|
| `src/app/main/bootstrap.ts`（真实 entry，旧 main/IPC 源已删除） | 有限落地的 bootstrap/window/lifecycle/menu + `platform/electron/ipc` registrars；见现行架构 Main 边缘拆分 |
| 已删除 `src/main/sessions.ts`；现 `src/app/main/{composition,create-session,chat-attachments,session-mapper,conversation-mapper}.ts`、`platform/electron/utility/session-process-adapter.ts` 与 `platform/filesystem/session-preparation.ts` | 有限 main 装配、应用边缘映射与 Electron utility 资源 Adapter 已分责；桌面人工验收仍未完成 |
| 已删除 `src/main/runtime.ts`；现 `platform/pi/runtime/discovery.ts`、`platform/pi/process/environment.ts`、`platform/filesystem/expand-home.ts`、`app/main/desktop-preferences.ts` | 用户安装同步发现、环境、home expansion 与既有 Chat 参数边缘分责；不是新增业务核心 |
| 已删除 `src/main/{project-resources,session-preparation}.ts`；现 `platform/filesystem/{project-resources,session-preparation}.ts` | 资源存在性祖先扫描与 cwd 准备 Adapter，复用 expand-home；app 保留 UUID 与同步创建段，无 Workspace 空层 |
| 已删除 `src/main/rpc-host.ts`；现 `src/app/workers/pi-rpc.worker.ts` 与 `platform/pi/rpc/*` | Pi RPC utility entry 与 framing/writer/mapping Adapter 分离；Conversation owner 不变 |
| 已删除 `src/main/pty-host.ts`；现 `src/app/workers/pty.worker.ts`、`platform/pty/output-flow.ts` 与 `platform/process/process-tree.ts` | PTY utility entry、输出流控与共享进程树 Adapter 分离 |
| 已删除 `src/main/git.ts`；现 `modules/change-review` + `platform/git/review-adapter.ts` + IPC mapper | 有限落地的 scope/成员准入与 Git/fs 资源分离；真实仓库/桌面验收后置 |
| 已删除 `src/main/preferences.ts`；现 `modules/preferences` + `platform/filesystem/preferences-storage.ts` | 唯一 current/owned recents 与磁盘兼容/串行 IO 分离；main 保留 runtime/DTO/Session 补偿 |
| 已删除 `src/main/preload.cts`；现 `src/app/preload/desktop-api.cts` | 唯一 sandbox preload entry，构建输出为 `dist/app/preload/preload.cjs` |
| 已删除 `src/shared/{contracts,chat,chat-validation,git,missing-assistant-diagnostics}.ts`；现 `src/shared/ipc/{desktop-api,conversation,conversation-validation,change-review,missing-assistant-diagnostics}.ts` | 跨进程 DTO、事件、验证与诊断 metadata codec 由 IPC seam 单一声明；无 shared 顶层兼容入口 |
| 已删除 `src/renderer/App.tsx`；现 `src/renderer/app/App.tsx` | renderer composition root，连接 `renderer/app` owner 与 `renderer/features/*` |
| 已删除顶层 `src/renderer/ChatPane.tsx`；现 `src/renderer/features/conversation/{ChatPane,chat-state,missing-assistant-diagnostics}.ts(x)` | Conversation Presentation、投影 reducer 与 renderer 诊断，公开入口为 feature index |
| 已删除顶层 `src/renderer/TerminalPane.tsx` / `terminal-keys.ts`；现 `src/renderer/features/terminal` | Terminal Presentation 与 modified Enter 协议适配，公开入口为 feature index |
| 已删除顶层 `src/renderer/GitPanel.tsx` / `diff-lines.ts`；现 `src/renderer/features/change-review` | Change Review Presentation、diff 与 scope projection，公开入口为 feature index |
| 已删除 `src/renderer/session-state.ts` 与顶层 `WorkspaceNavigation.tsx`；现 `renderer/features/workspace` | 唯一窗口投影/选择、导航、草稿/handle 与 reference path 格式化；不是后端生命周期 owner |
| `src/renderer/ContentView.tsx` | Conversation 与 Change Review 暂时共用的 presentation seam；待 UI 收敛阶段决定最终归属 |
| `src/renderer/ui` | 唯一通用 UI 系统，清除业务与 preview 内容 |
| `src/renderer/modules` | 按所属领域迁入 `renderer/features/*` 或下沉到 `renderer/ui`；不保留模糊聚合目录 |

此表是迁移入口，不是机械的一对一搬运清单。移动前先确认所有权和 Interface，移动后删除旧路径。

## 15. Agent 执行协议

后续 Agent 在架构、重构或新增跨模块功能前必须：

1. 完整阅读本文、当前 `docs/architecture.md` 和相关领域设计；
2. 检查当前代码、测试、Git 状态和用户未提交改动，以代码和测试纠正文档漂移；
3. 声明本次涉及的领域上下文、进程边界、状态所有者和允许修改范围；
4. 先定义或确认 Module Interface，再移动实现；
5. 保持一个状态一个权威所有者，保持 Pi/Electron/Git 在 Adapter 后；
6. 为迁移设置可检查的完成条件和旧路径删除条件；
7. 运行与改动风险相称的 typecheck、测试、build 和 smoke；
8. 更新实现状态文档，不把目标结构描述为已经落地。

若实现事实与本文冲突：

- 安全、会话所有权、数据完整性或用户明确要求冲突时立即停止并报告；
- 目标设计已不适用时先更新架构决策并说明权衡，再修改生产结构；
- 仅路径名称变化但原则仍成立时，以原则和领域所有权为准。

## 16. 重构完成定义

全量架构重构只有在以下条件全部满足时才完成：

- 顶层进程与权限边界清楚且被工具强制；
- Workspace、Session、Conversation、Change Review、Preferences 的领域所有权无重复，Terminal 作为服从 Session 策略的支撑模块边界清楚；
- Electron、Pi、PTY、Git 和文件系统均在明确 Adapter 后；
- Session 和 Conversation 核心规则可脱离 Electron/React 测试；
- App 和 main entry 只承担组合；
- 生产只有一套 UI primitive、theme 和 layout 系统；
- IPC 拥有统一 channel、DTO 和运行时 schema；
- tests/fixtures 的 TS/TSX 纳入 TypeScript，`.mjs` fixture 通过可执行回归与 smoke 纳入统一 verify；
- Electron smoke 与生命周期清理验证通过；
- 旧目录、过渡 Adapter 和重复状态已删除；
- 当前架构文档从“目标”更新为“已实现”，README 指向有效。

目录看起来更整齐不构成完成；依赖方向、状态所有权、可替换 Seam 和可执行验证才构成完成。

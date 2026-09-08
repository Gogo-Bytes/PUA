# PUA 目标架构

状态：**目标设计，重构尚未执行**。本文是后续架构重构、新模块设计和代码评审的规范来源；当前已实现行为仍以代码、测试、[现行架构](architecture.md) 和 [原生对话设计](native-chat-design.md) 为准。

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
Worker:   Pi/PTY Adapter → shared/ipc worker protocol
```

`modules/*` 是 main-side 业务核心；renderer 通过 Desktop Client Facade 和 IPC 使用 application use case，不能直接 import 业务核心。Renderer 可以拥有纯 view model、selector 和 projection reducer，但它们只解释 shared IPC DTO，不成为第二份领域规则。

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
      dialogs/
      clipboard/
      shell/
    pi/
      rpc/
      runtime/
      process/
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

- 项目标识和最近项目；
- 项目与会话的视图关系；
- 当前项目、当前会话和每项目最后活跃会话；
- 工作区布局偏好。

不拥有会话进程生命周期、对话消息或 Git 命令执行。

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

拥有桌面外壳偏好及其归一化规则。Pi 的模型、凭据、技能、工具和扩展配置不属于 PUA Preferences。

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
| 当前项目/会话选择 | Workspace application state | 不由单个 Tab 组件持有 |
| 每会话草稿 | Workspace/Conversation presentation store | 以 session id 索引，切换不卸载丢失 |
| 附件 token 与文件路径 | main-side Attachment Adapter | renderer 只持 opaque id 和展示元数据 |
| panel 展开、tooltip、输入框高度 | React 局部 UI | 不进入 domain |
| theme preference | Preferences | resolved theme 可作为 presentation context |

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
test/fixture typecheck
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

完成条件：

- 所有权、互斥、启动和关闭规则可在无 Electron 环境下测试；
- `SessionCoordinator` 不读取文件、不解析 RPC、不操作 React；
- Chat/Terminal process Adapter 通过明确 Port 接入；
- 应用关闭先封锁 create/start，且创建流程所有 `await` 后在预留所有权前复查准入；对应 race test 通过；
- 生命周期和进程清理 smoke 保持通过。

### 阶段 3：提取 Conversation 与 Adapter

完成条件：

- Pi 原始 RPC 类型不越过 Adapter；
- streaming、tool、queue、Extension UI 和 attachment 规则有独立测试；
- renderer 只消费 Conversation projection 和 application command；
- 原生对话完整 smoke 保持通过。

### 阶段 4：按 Feature 重建 Renderer

完成条件：

- `App.tsx` 只承担组合，不拥有各 Feature 工作流；
- Workspace、Session、Conversation、Terminal、Change Review、Preferences UI 各自可定位；
- 旧/new Theme、Icon、Dialog 和布局体系完成收敛；
- 草稿、附件、后台事件、滚动和焦点无回归。

### 阶段 5：Change Review、Preferences 与发布治理

完成条件：

- Git 和 Preferences 通过 application Interface 使用；
- 测试目录与新模块对应；
- CI 和目标平台 release matrix 建立；
- README、现行架构和本目标文档与实现状态同步。

每阶段结束都应删除被替代路径和兼容胶水。迁移代码只有明确下一阶段和删除条件时才允许存在。

## 14. 当前文件到目标位置的指导映射

| 当前区域 | 目标职责 |
|---|---|
| `src/main/main.ts` | `app/main` composition root + `platform/electron/ipc` registrars |
| `src/main/sessions.ts` | Session domain/application + Chat/Terminal process Adapters + Attachment Adapter |
| `src/main/rpc-host.ts` | `platform/pi/rpc` 与 RPC worker |
| `src/main/pty-host.ts` | Terminal PTY Adapter 与 worker |
| `src/main/git.ts` | Change Review Port 的 Git Adapter |
| `src/main/preferences.ts` | Preferences infrastructure |
| `src/main/preload.cts` | `app/preload/desktop-api` |
| `src/shared/*.ts` | 拆分为领域内部类型或 `shared/ipc` DTO/schema |
| `src/renderer/App.tsx` | `renderer/app` composition + `renderer/features/*` |
| `src/renderer/ChatPane.tsx` | Conversation Presentation |
| `src/renderer/TerminalPane.tsx` | Terminal Presentation |
| `src/renderer/GitPanel.tsx` | Change Review Presentation |
| `src/renderer/session-state.ts` | Workspace application state |
| `src/renderer/chat-state.ts` | Conversation projection/reducer |
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
- tests/fixtures 纳入 TypeScript 和统一 verify；
- Electron smoke 与生命周期清理验证通过；
- 旧目录、过渡 Adapter 和重复状态已删除；
- 当前架构文档从“目标”更新为“已实现”，README 指向有效。

目录看起来更整齐不构成完成；依赖方向、状态所有权、可替换 Seam 和可执行验证才构成完成。

# 问题报告：异步工程编排在验收解析与主管问答后失去自动接续

状态：待 Skill / pi-subagents 维护方定位与修复。

## 1. 摘要

PUA 原生聊天重构使用工程团队 Skill 与 pi-subagents 异步工作流：单一开发线程 → 并行独立评审 → 单一修复线程 → 最终评审。

实际发生两类中断：

1. 开发完成后，验收报告解析失败，整个工作流失败，后续评审未执行。
2. 恢复工作流中，部分评审结果以 detached 占位信息进入后续节点；修复线程请求主管决策后，外层工作流暂停。主管回复可以让子线程继续，但目前没有证据证明原外层工作流会自动恢复并执行最终评审。

主线程同时遵循“异步任务运行时让出交互”的指引，连续结束当前回复，用户看不到清晰的持续任务状态，担心子线程完成后无人接管。

**本报告记录的是已观察到的行为及恢复缺口，不把尚未检查的工具内部实现归因为已确认缺陷。**

## 2. 环境与相关材料

- 项目：PUA — Pi Universal App，Electron / React / TypeScript。
- 工作目录：`/Users/gan/Desktop/🥷/PUA`。
- 本机 Pi 基线：`@earendil-works/pi-coding-agent` 0.84.4。
- 工程团队 Skill：`.agents/skills/orchestrate-engineering-team/SKILL.md`。
- 子代理 Skill：`/Users/gan/.pi/agent/npm/node_modules/pi-subagents/skills/pi-subagents/SKILL.md`。
- 相关子代理参考文档：`references/execution-controls.md`、`references/constraints-and-recipes.md`。
- 未核验 pi-subagents 扩展的具体版本；维护方应从运行环境或日志补充。

相关指引：

- 默认使用 `workflowScript` + `async:true`，多个节点在一个脚本内组织。
- 常规并行节点通过 `await runs.all(...)` 收集，再把 `.output` 传给后续节点。
- 交互会话通常应让出控制，依赖完成通知唤醒；不能用轮询或 sleep 等待。
- 子代理可以通过主管通道请求决策。
- detached 子线程应先回复主管请求，再等待该原线程；不能重复启动替代线程。

这些指引单独成立，但组合时需要明确“子线程等待”和“外层工作流恢复”的契约。

## 3. 原定流程

用户批准完整技术方案并要求实施。主线程启动：

```text
implement-native-chat
  → protocol/security/product/maintainability reviews（并行）
  → fix-reviewed-findings
  → final reviews（并行）
  → final fix / validation
  → Main 最终验收
```

仅开发/修复节点允许写项目，同一时刻保持一个 writer。主线程让出交互不应代表整个任务完成。

## 4. 事件 A：开发报告解析失败阻断后续评审

### 已观察到的事实

初始工作流：`918f74ae-aa58-4be6-82d3-a556fdeb62c4`。
开发子线程：`eb445785-73f0-48ee-9ca7-ac9a8285c961`。

开发节点配置了：

```js
acceptance: {
  level: 'checked',
  evidence: [
    'changed-files', 'tests-added', 'commands-run',
    'validation-output', 'residual-risks', 'no-staged-files'
  ]
},
output: '.agent-work/native-chat/implementation-handoff.md'
```

节点已生成实现、测试与 Markdown 交付报告，但宿主返回：

```text
Acceptance rejected: Failed to parse acceptance-report:
Unexpected token 's', "status: pa"... is not valid JSON
(in configured output .../implementation-handoff.md)
```

外层工作流因此失败，后续评审没有执行。

### 独立核验

主线程随后确认代码改动存在，并自行执行：

- `git diff --check`：通过。
- `npm run typecheck`：通过。
- `npm test`：5 个文件，32 项测试通过。

这只能证明实现并未随工作流失败消失，以及这些检查通过；不能替代独立评审，也不能证明整个产品可交付。

### 定位边界

可以确认：解析器拒绝了报告格式，且异常向上传播阻断后续节点。

尚不能确认：问题究竟来自生成报告的指令、模型未遵循 schema、输出文件提取规则、解析器实现，还是它们的组合。需维护方检查实际 acceptance-report 内容与提取过程。

## 5. 事件 B：detached 结果与主管问答破坏流程接续

### 恢复流程

主线程启动恢复工作流：`d24bddde-ab56-4681-aedb-f04ca73897ef`。

```text
三路只读评审
  → recovery-fix
  → recovery-final-review
```

评审节点通过 `await runs.all(...)` 收集，脚本把各节点 `.output` 拼接传给修复节点。

### 评审的主管请求

两位 reviewer 的有效工具不允许运行 Git，向主线程请求当前 diff/status。主线程保存文件并通过主管通道回复：

- `.agent-work/native-chat/review-diff.patch`
- `.agent-work/native-chat/review-stat.txt`
- `.agent-work/native-chat/review-status.txt`
- `.agent-work/native-chat/review-staged-stat.txt`

主线程特别说明未跟踪文件不在普通 git diff 内，需要直接读取。

后来，评审完整报告作为“Detached foreground task completed”通知送达主线程。

### 修复线程发现上游结果缺失

修复线程：`56455ac5-d452-4a36-9bc1-463fc6599428`。

修复线程请求主管决策，原文要点：

```text
Writer received only product report;
protocol/security outputs are detached placeholders.
Please supply final report paths/text.
```

同时询问终端独占的安全取舍。

这说明至少在本次执行中，脚本虽然使用了 `await runs.all(...)`，但传给依赖节点的部分 `.output` 并不是最终评审正文。维护方应定位 promise 完成、detach 通知和最终输出的关系，不能仅根据这一次观察推断所有 runs.all 都存在此行为。

### 外层暂停

宿主随后返回：

```text
Background task paused: workflow
Run 'recovery-fix' detached
Detached for intercom coordination: worker.
Reply to the supervisor request first, then wait with
subagent_wait({ id: "56455ac5-d452-4a36-9bc1-463fc6599428" }).
Do not resume or launch a replacement while it remains detached.
```

### 手工恢复措施

主线程：

1. 将完整评审结论整理到 `.agent-work/native-chat/recovery-findings.md`。
2. 回复主管请求 `344597cc-0d8f-47da-845c-ecc8a3823342`，给出报告路径与安全决策。
3. 对原修复线程注册非阻塞唤醒：

```js
subagent_wait({
  id: '56455ac5-d452-4a36-9bc1-463fc6599428',
  nonBlocking: true
})
```

宿主返回订阅：`aaaf25b5-274d-4491-b4fb-891741ba8574`。

4. 后续 status 确认修复线程仍在运行、工具调用和轮数持续增加。

**初次记录时，没有确认修复完成，也没有确认暂停的外层脚本会自动恢复到 recovery-final-review。** 注册子线程完成唤醒不等于验证外层依赖链已经恢复。

后续核验：修复子线程完成后，宿主发出 `Workflow completed after detached child ... finished`。Main 查询恢复工作流，状态为 `complete`，但仅列出四个节点：三位 reviewer 与 recovery-fix，**没有原脚本中第五个 recovery-final-review 节点**。因此现在可以确认：本次外层流程被标记完成，但计划中的最终评审未执行。Main 随后另行启动最终复审工作流 `8fb86a5b-63f4-4c4c-b8e4-10f731547c43` 接续验收。这是具体的后续节点遗漏证据，不只是潜在风险。

此外，原完成唤醒订阅曾因超时失效，而子线程仍在运行；Main 检查状态后重新注册。期间一次对子线程的 steer 返回 `Workflow ... has no live foreground child`，与直接查询子线程仍为 running 的状态不一致。工具未接受该次指导，Main 没有把它当成已送达，也没有重复启动 writer。

## 6. 用户影响

- 主线程多次结束当前回复，用户误以为整个任务已停止或结案。
- 任务虽然在后台运行，但“谁负责接续、下一步是什么、原工作流是否仍有效”不透明。
- 实现完成与验收完成容易混淆。第一轮测试全过后，独立评审仍发现 RPC 注入、并发会话写入和进程清理等高风险问题。
- 下游修复节点可能在没有完整上游评审的情况下启动。
- 主线程需要手工拼接报告、补交上下文和重新接续流程，恢复依赖人/模型记忆。
- 原恢复工作流在修复子线程完成后被标记 complete，但未执行脚本中最后的 recovery-final-review。Main 通过检查节点清单发现遗漏，并手动启动独立最终复审。若只信任顶层 completed 通知，任务会停在“修复已完成但未验收”。

## 7. 原因分层：不要只归咎于 Skill

### 已确认

- Skill/tool 指引采用异步让出交互，因此当前 assistant turn 结束是预期行为。
- 报告格式解析失败导致初始工作流失败。
- 部分评审正文未进入修复节点，修复线程收到 detached 占位信息。
- 主管问答使恢复工作流暂停，需手工回复并等待原子线程。
- 主线程的阶段表述过于像最终交付，没有持续明确区分等待、修复、验收、完成。

### 需要维护方验证的假设

- 编排 runtime 可能把非终态 detached 状态当作 promise 的返回/失败边界，而不是继续等待最终结果。
- 外层脚本在子节点等待主管时可能没有可恢复 continuation，或其恢复方式未在当前指引中明确。
- 验收报告的自由文本输出与机器 JSON 解析契约可能存在不一致。
- 不同能力上限下的 reviewer 工具集，与任务默认要求运行 Git/浏览器不匹配，导致额外主管请求。

### 主线程编排责任

- 不应把占位 `.output` 当作下游可用的完整报告。
- 不应把“订阅子线程完成”表述成“整条流程已恢复”。
- 应在异常后明确剩余节点与接续责任，而非仅重启部分流程。
- 不应因为工具包报告格式失败就隐去真实代码产物，也不能因此跳过验收。

## 8. 建议修复

### Skill / 指引层

1. 明确状态词：`后台运行中`、`等待主管决策`、`外层流程暂停`、`待主线程验收`、`已交付`，避免中途回复呈现结案语气。
2. 规定完成条件：开发节点完成不等于用户任务完成；最终评审和必要验证必须明确完成或说明阻塞。
3. 给出 supervisor/detach 的标准恢复路径，区分恢复子线程与恢复外层流程。
4. 下游消费结果前验证其为最终结果；遇到 detached 占位内容时停止依赖节点，而非继续传递。
5. 验收报告格式错误时优先请求修正报告，不重新实现、不丢弃代码、不跳过独立评审。
6. 预先匹配 reviewer 有效工具能力；若不允许 Git，由 Main 提供带基线、未跟踪文件清单和 staged 状态的只读 diff 材料。

### runtime / 工具层（若源码定位确认）

1. 将 `waiting-supervisor` / `detached-running` 作为非终态；已 await 的节点只有最终完成/失败/取消才向依赖者提供结果。
2. 对执行状态与最终输出使用结构化字段，避免通过 `.output` 中自然语言占位符判断完成。
3. 主管回答后自动恢复原节点；原节点完成后恢复原外层 continuation。若不支持，明确返回 `continuationLost` 与未执行节点列表，而不是让调用方猜测。
4. 在报告 schema 错误时保留实现结果，提供仅修复交付报告的受控路径；不能把格式失败当成产品验收成功。
5. 完成通知与订阅应幂等且关联精确 run id；恢复时可查询尚未消费的最终结果与未执行的依赖节点。
6. 暴露明确的有效工具清单和权限限制，避免 reviewer 的只读权限被误解为“可以执行所有只读 shell 命令”。

不建议为解决本问题直接强制所有任务同步阻塞，也不建议在 Skill 中再造一套任务数据库、锁、队列或生命周期引擎。优先修复宿主原生状态契约，并在 Skill 中给出清晰恢复规则。

## 9. 最小复现建议

### 场景 A：验收格式错误

1. 启动带 checked acceptance 的 writer，输出一个实现文件与包含非 JSON acceptance-report 的 Markdown 报告。
2. 后接只读 reviewer。
3. 观察是否整个 workflow 失败，是否能仅修正报告后继续 reviewer，是否保留产物与“未验收”状态。

### 场景 B：并行 reviewer 请求主管

1. `await runs.all([reviewerA, reviewerB])`，其中 reviewerA 主动请求主管数据。
2. 主线程回复，reviewerA 最终返回特征字符串。
3. 将两个 `.output` 传给 writer。
4. 断言 writer 收到两份最终正文，而非 detached 提示。

### 场景 C：writer 中途需要决策

1. reviewer → writer → finalReviewer。
2. writer 请求主管决策，主线程回复。
3. writer 完成。
4. 断言 finalReviewer 自动执行一次；若不支持自动接续，宿主必须明确报告待恢复节点，Main 能可靠接续。

### 场景 D：让出交互与恢复

1. 主线程结束当前回复时子线程仍运行。
2. 子线程完成/失败/主管等待分别触发通知。
3. 断言通知不丢失、不重复启动 writer，主线程准确知道整个用户任务是否完成。

## 10. 修复验收标准

- 主管问答不导致最终评审静默跳过。
- 下游绝不将 detached 占位提示作为最终报告。
- 回答同一主管请求不会启动重复 writer。
- 验收格式修复与产品实现、测试、评审结果分开记录。
- 主线程让出交互后可可靠恢复接续；状态明确显示“待完成”，而非误称交付。
- 包含超时、取消、重启/恢复、重复通知、部分并行节点失败的测试。
- 能清楚说明该修复属于 Skill 指引、工具 runtime 或两者，不用泛化措辞掩盖责任边界。

## 11. 本机证据索引（外部维护者需由用户选择性提供）

- 初始任务摘要：`.agent-work/native-chat/brief.md`
- 首轮实现报告：`.agent-work/native-chat/implementation-handoff.md`
- 合并后的评审问题：`.agent-work/native-chat/recovery-findings.md`
- 原工作流 run：`918f74ae-aa58-4be6-82d3-a556fdeb62c4`
- 恢复工作流 run：`d24bddde-ab56-4681-aedb-f04ca73897ef`
- 安全 reviewer：`f1528d12-3b89-4c6e-a9e4-5f7087cb0235`
- 协议 reviewer：`a91e757f-0111-41ac-9386-59bdeb0ad0e4`
- 产品 reviewer：`e524a3f9-8329-46a0-a9f5-893b4667699c`
- 等待主管后继续的修复 writer：`56455ac5-d452-4a36-9bc1-463fc6599428`

本报告未复制完整会话、隐藏推理或凭据。上述运行 id 和本机路径仅供定位，不是跨机器可访问链接。不要直接上传完整 session 日志；需要证据时只导出相关工具事件并先检查敏感信息。

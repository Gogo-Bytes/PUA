# PUA：Codex Desktop 对照研究与 0.2 改进

研究对象是如何改善 **PUA（Pi Universal App）** 的桌面体验；Codex Desktop 是对照产品，不是 PUA 的运行内核。产品定位见 [README](../README.md)。

状态：0.1 基线 `95e360e` 已推送；本研究指导下一版，不改变 Pi 的执行策略。

## 来源与证据边界

2026-09-05 通过真实浏览器读取 OpenAI 官方文档。旧 `developers.openai.com/codex/app/...` 链接当前重定向到 `learn.chatgpt.com` 的统一桌面文档，下文区分 Codex 专属功能与共用桌面设计，**不把重定向后的内容当成旧版 Codex Desktop 的历史快照**。

1. [App](https://learn.chatgpt.com/docs/app)：多个项目/长时间会话可见，工作成果在同一工作区检查，跨工具协作。
2. [Code review](https://learn.chatgpt.com/docs/code-review?surface=app)：review pane 的 staged/unstaged/branch 等范围；明确展示的是整个仓库状态，不只是 agent 改动；文件级/行级反馈与变更检视形成闭环。
3. [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)：Codex 用独立 Git worktree 支持并行任务和 Local/Worktree 交接；避免并行写入同一工作目录。隔离并不是免费复制，需要环境、依赖、忽略文件及清理策略。
4. [Scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app)：后台任务、结果收件箱、未读/需关注提示；任务执行与结果查看分离。原生权限策略是该产品自身政策，不是本项目要照搬的 GUI 必需品。
5. [Features](https://learn.chatgpt.com/docs/features)：项目/聊天导航与工作产物能力的聚合入口。

OpenAI 原始发布博客遭遇 Cloudflare 挑战，未绕过或声称读到内容。本机未找到 Codex Electron 应用，未登录用户账户，也没有把官方文档研究说成实机竞品测试。不以“热门”作为已有指标证据。

## 学习的是交互闭环，而非外观

| 优点 | 0.1 欠缺 | 0.2 对应优化 |
|---|---|---|
| 项目与线程是一级信息，能快速找回工作 | 同项目标签同名，长会话列表难找 | 会话筛选、桌面显示名、明确项目位置 |
| 执行旁边就能检查真实成果 | 只有终端输出，必须切编辑器看 diff | Git 变更面板，工作区/暂存范围，文件列表与 diff |
| 给反馈不需要重新描述文件位置 | 多行草稿与 diff 脱节，切会话共用草稿容易串任务 | 每会话独立草稿，文件级反馈引用插入 Pi |
| 后台并行任务仍可见且可回收 | 进程存活与“agent 工作中”容易混淆 | 显示进程状态而不虚构 agent 状态；维持真实终端入口 |
| 可选隔离环境，而不是无条件并行 | 多个标签可能写同个目录 | 清楚标明本地目录；本版不自动创建/删除 worktree，后续显式可选 |

## 这次不照搬的东西

- 不复制 Codex 模型/账号体系、审批策略、沙箱、任务预算或强制工作流。
- 不为了展示漂亮状态去猜测 ANSI 文本中的 “done”。进程状态不等于模型完成事件。
- 不把整个仓库 diff 标成“Pi 改动”，也不宣称知道最后一轮改了哪些文件。
- 不默认暂存、回滚、提交或推送用户代码。0.2 diff 面板为只读审查入口；Pi 本身的 git/bash 能力不受影响。
- 不为缩小 UI 工作量取消自定义 TUI 扩展。原生终端保留为兼容底座，之后的结构化视图应渐进增强。

## 演进顺序

1. 0.2：改进找到会话 → 查看真实变更 → 给 Pi 反馈的最短路径。
2. 后续：可靠 Pi 事件桥接的状态、用量、通知和可选结构化聊天；必须标明 UI 能力差异，避免双进程同时写一份会话。
3. 再后续：用户主动选择的 worktree 创建/交接、扩展提供的后台任务可视化。先确认生命周期与恢复事实，再加调度界面，不强塞 agent 框架。

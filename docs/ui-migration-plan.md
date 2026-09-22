# 全界面 shadcn / Base UI 迁移计划

2026-09-22：用户授权规划并实施所有适用 UI 的替换，包含生产接入。起点 `5c0e719`，工作区干净。之前的隔离预览确认门槛由本次明确实施授权解除；每阶段仍必须验证，不把依赖安装当迁移完成。

## 范围与所有权

只改 renderer 通用 UI、Feature 展示及对应测试/预览/样式。主进程、preload、IPC、会话生命周期、草稿/附件/队列/请求身份不迁。统一入口仍为 `renderer/ui`；shadcn 源码适配和 Base UI 行为藏在该 Interface 后。已有 `--ui-*` 是唯一主题权威，Tailwind 不开启全局 Preflight。

## 分阶段清单

| 阶段 | 覆盖 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| 1 通用交互底座 | Select、DropdownMenu、Tabs、Collapsible；Tailwind 生产/两预览接入；Portal 主题归属 | 删除手写 ChoicePopup/焦点遍历，全部既有调用走同一实现，键盘/窄窗回归 | 已实施 |
| 2 浮层与反馈 | Dialog、Tooltip、Toast、Message、Tag/StatusBadge | 焦点锁/恢复、嵌套菜单、长内容、关闭锁、时长/暂停/队列逐项迁移或记录保留理由 | 已实施；保留项见下 |
| 3 表单与页面控件 | Button/IconButton、Input/Textarea、Checkbox/Radio/Switch/Slider；设置、新建/改名、任务详情、历史搜索、扩展表单 | 所有适用表单统一；保留原校验、提交/禁用/异步语义 | 待实施 |
| 4 对话与命令 | 模型 Combobox、思考 Select、添加菜单、命令面板、共享 `/` 和 `@` 建议 | 光标 token/选区、IME、Escape、方向键/Enter、选择不误发、旧请求不串会话 | 待实施 |
| 5 工作台领域组合 | Sidebar、SessionTabs、Breadcrumbs、工具详情、检查器/文件行、搜索/空错误状态 | 消费统一控件；保留文件夹/末端浮层设计；无旧重复交互 | 待实施 |
| 6 清理与验收 | 样式/旧实现/文档/测试门禁 | 迁移清单闭合、类型/构建/单测/隔离浏览器证据，列出剩余真实桌面验收 | 待实施 |

不机械替换：xterm/PTY、Markdown/源码安全渲染、Virtuoso 流式列表、Git diff 内容、会话/草稿状态 owner。ResizableWorkspace 的尺寸持久化、拖拽和 GSAP 属于领域布局能力；无行为等价方案前保留，不因组件库有 Sidebar/Resizable 名称就重写。

静态通知、标签、语义 HTML 不需要虚构 Base UI 依赖：统一样式即可。原生文本控件可以作为 shadcn 样式化原语，重点是 Interface 一致而不是禁止 HTML。

## 验证与交付

每阶段 typecheck、tests typecheck、相关行为测试、build、隔离浏览器（明暗、窄窗、焦点、键盘）。迁移前记录全量失败基线；后续对比新增失败，不删除或放宽业务断言以变绿。旧冻结 hash 与已批准 UI 迁移冲突，最终单独记录授权与更新范围，不跳过行为测试。

每阶段完成后提交并推送当前分支；推送失败停止。真实 Pi 请求、会话关闭/删除、系统文件选择器不用于自动预览验收。系统中文输入法与真实桌面交互最终人工验收单列。

### 阶段 1 结果

公共 Select / DropdownMenu / Tabs / Collapsible 已由 Base UI 管理导航、选择、定位与展开语义。Portal 使用所属 UIProvider 或 Dialog 容器；调用接口和业务状态 owner 不变。Tailwind 已进入生产与两类预览，无全局 Preflight。删除旧 ChoicePopup 和死样式。

Base Select 允许键盘聚焦禁用选项以阅读，但不允许提交；与旧实现跳过禁用项的行为不同。真实浏览器验证 disabled、方向键、Home/End、Enter、Escape、Tab、外部点击、菜单回调、焦点恢复、明暗/窄窗，无页面错误。定位与焦点检查从无布局 jsdom 移至 `choice-controls-check.mjs`；26 项相关接口/业务测试、类型检查和构建通过，shadcn 嵌套 Dialog 预览通过。截图 `/tmp/pua-choice-controls`。迁移前全量基线 2660 passed / 36 failed，仍需最后比对；不宣称全量通过。

### 阶段 2 结果与明确保留项

Dialog 改为 Base UI Root/Portal/Backdrop/Popup/Title/Close；删除原生 showModal、手写 Tab 查询和手写关闭焦点管理。调用方 initialFocusRef、closeOnBackdrop 不变，closeDisabled 统一阻止按钮、Escape、外部关闭；本轮不为弹窗另外引入动效引擎。9 项 primitive 测试改用真实键盘语义与异步焦点断言，未删除焦点/禁用/radio 检查；shadcn 嵌套菜单和长 Tooltip 浏览器回归通过。

- Tooltip 保留原生 top-layer Adapter：它是完整长标题阅读区，支持 Tab 进入滚动全文、独立 hover/focus 保持、祖先滚动重新定位。直接换普通 Base Tooltip 会丢失这些已验证能力。明暗/窄窗/全文 End/嵌套 Dialog Escape 专项验收通过。
- Toast 保留已有受控队列与可见时间计时 Adapter。Base/Sonner 自有通知状态不能直接替代 items/onDismiss 的 owner 契约；等待项开始计时、暂停/恢复和一次性回调仍由已有测试覆盖，不增加第二套全局通知仓库。
- Message、Tag、StatusBadge 是静态语义展示，沿用主题 token 与统一 Button，不包装没有交互价值的库原语。

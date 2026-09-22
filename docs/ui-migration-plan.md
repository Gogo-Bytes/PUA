# 全界面 shadcn / Base UI 迁移计划

2026-09-22：用户授权规划并实施所有适用 UI 的替换，包含生产接入。起点 `5c0e719`，工作区干净。之前的隔离预览确认门槛由本次明确实施授权解除；每阶段仍必须验证，不把依赖安装当迁移完成。

## 范围与所有权

只改 renderer 通用 UI、Feature 展示及对应测试/预览/样式。主进程、preload、IPC、会话生命周期、草稿/附件/队列/请求身份不迁。统一入口仍为 `renderer/ui`；shadcn 源码适配和 Base UI 行为藏在该 Interface 后。已有 `--ui-*` 是唯一主题权威，Tailwind 不开启全局 Preflight。

## 分阶段清单

| 阶段 | 覆盖 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| 1 通用交互底座 | Select、DropdownMenu、Tabs、Collapsible；Tailwind 生产/两预览接入；Portal 主题归属 | 删除手写 ChoicePopup/焦点遍历，全部既有调用走同一实现，键盘/窄窗回归 | 已实施 |
| 2 浮层与反馈 | Dialog、Tooltip、Toast、Message、Tag/StatusBadge | 焦点锁/恢复、嵌套菜单、长内容、关闭锁、时长/暂停/队列逐项迁移或记录保留理由 | 已实施；保留项见下 |
| 3 表单与页面控件 | Button/IconButton、Input/Textarea、Checkbox/Radio/Switch/Slider；设置、新建/改名、任务详情、历史搜索、扩展表单 | 所有适用表单统一；保留原校验、提交/禁用/异步语义 | 已实施 |
| 4 对话与命令 | 模型 Combobox、思考 Select、添加菜单、命令面板、共享 `/` 和 `@` 建议 | 光标 token/选区、IME、Escape、方向键/Enter、选择不误发、旧请求不串会话 | 已实施 |
| 5 工作台领域组合 | Sidebar、SessionTabs、Breadcrumbs、工具详情、检查器/文件行、搜索/空错误状态 | 消费统一控件；保留文件夹/末端浮层设计；删除重复菜单交互 | 已实施 |
| 6 清理与验收 | 样式/旧实现/文档/测试门禁 | 迁移清单闭合、类型/构建/单测/隔离浏览器证据，列出剩余真实桌面验收 | 已实施；全量门禁仍有基线失败 |

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

### 阶段 3 结果

Button/IconButton 使用 Base Button；Checkbox 使用 Base Checkbox。统一 Input/Textarea/Radio/Slider 原语保留原生 ref、事件与表单语义，Tailwind 管理焦点/禁用/主题；无手写键盘算法。现有页面没有 Switch，不增加虚假开关。所有 Feature 的文本框/多行框/单选/范围输入已迁移，任务策略下拉改用公共 Select，改名保存与目录按钮改用公共 Button。预览新增 checkbox/radio/slider。

修复未包 UIProvider 的独立挂载：Portal 默认回退到 document body（生产仍继承 provider）。表单测试按 Portal DOM、异步焦点、Escape 和追加样式类更新，保留所有原业务断言。47 项设置/新建/详情、19 项控件/通知测试通过；两个浏览器脚本和构建通过。原生 Radio/Slider 是刻意保留的稳定浏览器交互，不冒称为 Base UI Radio/Slider。

### 阶段 4 结果

模型使用 SearchSelect（Base Combobox），思考程度使用 Select，按打开菜单懒加载；当前模型即使不在返回列表仍有显示项。添加附件改为统一 Menu，只有真实 callback 对应的操作。命令面板与 Composer 共享 SuggestionOptions，Base Toolbar 管理 roving focus，集中补足公共 Toolbar 未暴露的 Home/End；Base Popover 管理输入建议的定位和外部关闭，输入不失焦。

两类对话统一 completionToken，跟踪 selectionStart/End，替换当前完整词段并恢复精确光标，保留后文；选区/IME 不弹建议，Escape 不发送。技能候选仅限消息开头（Pi 只展开开头 /skill），文件引用仍按 JSON 引号协议插入。草稿快照、附件与调用身份不迁移。

14 项 Composer/词段测试、3 项 Pending adapter 测试、类型/构建及 `composer-controls-check.mjs` 通过，截图 `/tmp/pua-composer-migration`。Pending 测试 stub 浮层 Interface，只检验资源/草稿/提交，不把 jsdom 的浮层布局结果当实际验收；真实弹层由浏览器脚本覆盖。系统真实中文输入法仍需人工验证。命令面板 App 旧测试仍先失败于迁移前的项目 title 查询，最终阶段列入统一基线校正。

### 阶段 5 结果

SessionTabs 溢出列表采用 Base Menu RadioGroup，移除手写 outside listener、菜单方向键和恢复焦点。Breadcrumbs 中间层改用共享 Menu，保留安全 href 检查与回调；删除原生 details 菜单路径。侧栏/工具卡/检查器/文件行已透过共同 Interface 消费 Base Button、Tabs、Collapsible 与新 Input；空态和静态错误仍为语义内容，不虚构库组件。项目名保留路径 title，恢复同名项目辨识。

保留的领域特例：SessionTabs 的可改名 tab 在编辑时会移出 tab 集合，其 id 焦点恢复和切换逻辑保留；项目树折叠集合、分支身份与 ResizableWorkspace 尺寸仍归 owner，不迁到 UI 库。它们不是第二套菜单实现。

17 项模块测试与 10 项通知/面包屑测试通过。面包屑浮层回调/安全链接/键盘与 SessionTabs Radio 菜单在 `navigation-controls-check.mjs` 真实浏览器验收；unit 仍检查常规链接安全与全文 Tooltip，不再用 jsdom 模拟菜单定位。侧栏专项明暗/窄窗/改名/折叠/透明按钮验收通过，证据 `/tmp/pua-sidebar-menu`。

### 阶段 6 结果与未闭合验收

清理旧 slash/skill 菜单、原生 select、Breadcrumb disclosure 和 SessionTabs 菜单样式；App 终端搜索也统一 Input。Feature/App 不再直接声明原生 input/textarea/select/button。补上后台对话浮层隔离和检查器 Escape 对 dialog/listbox 的边界。组件与生产契约同步为实际结构。

类型检查、测试类型检查、生产构建、导入/通道边界通过。批准的全 UI 迁移将保护 manifest 从 35 个文件更新到 52 个；保留增删改名/内容/符号链接检测算法与测试，不跳过保护门禁。检查点为阶段 5 提交，具体字节由本阶段 manifest 锁定。

全量单测最终 2672 passed / 24 failed，对比迁移前 2660 / 36，没有新增失败用例身份；不是全量通过，也不能据此声称剩余用例失败原因完全相同。剩余分布：App composition structure 1、App composition 7、ResizableWorkspace 6、renderer 3、App command palette 6、App settings 1。涉及旧标签/尺寸/同步焦点和原 DOM 断言，命令面板还存在订阅/投影断言待进一步校正。报告 `/tmp/pua-ui-before.json` 与 `/tmp/pua-ui-final.json` 为本机临时证据；未把这些失败删除或设为 skip。

workspace-renderer、desktop-client-renderer、component-modules 共 43 项和 missing-assistant-replay 6 项专项全通过。传输/草稿测试通过 `attachment-menu-contract.tsx` 隔离 jsdom 浮层几何循环，只替换附件菜单与建议定位，保留原业务断言；实际浮层由真实浏览器专项验证。

真实 Chrome 隔离验收覆盖 choice、shadcn、composer、navigation、tooltip、sidebar、workspace-dialog 与 workspace-demo；不连接 Electron/Pi/Git/真实磁盘。workspace-demo 明暗主题 1440–360px 无横向溢出、无页面错误/真实请求；通过附件两步菜单、A→B→A 草稿、发送/换行、命令面板焦点、键盘调宽。workspace-dialog 验证 Tab/Shift+Tab 循环及关闭恢复（等待 Base focus guard 下一帧完成）。截图 `/tmp/pua-demo-unification/workspace` 与各阶段上述路径。

真实系统中文输入法、系统附件选择器和 Electron 原生窗口集成仍需人工验收。构建存在大 chunk 警告；本阶段不为 UI 迁移改变打包/进程边界。全量 `verify` 目前仍受上述 24 项失败阻挡。

最终 `component-preview/browser-check.mjs` 综合验收亦通过：Select 键盘、Base Dialog 焦点、通知 hover/focus 暂停/卸载、异步提交草稿/附件保留、跨会话失败隔离、改名焦点、真实指针调宽、响应式焦点恢复、80 轮结构展开/重播资源有界、reduced-motion。菜单已不使用自定义 GSAP 入场，断言为完整可读；保留的 Toast/布局动画继续检查中间态和卸载清理。证据 `/tmp/pua-browser-final.log`、`/tmp/pua-component-completion-evidence`。

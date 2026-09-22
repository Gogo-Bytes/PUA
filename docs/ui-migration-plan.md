# 全界面 shadcn / Base UI 迁移计划

2026-09-22：用户授权规划并实施所有适用 UI 的替换，包含生产接入。起点 `5c0e719`，工作区干净。之前的隔离预览确认门槛由本次明确实施授权解除；每阶段仍必须验证，不把依赖安装当迁移完成。

## 范围与所有权

只改 renderer 通用 UI、Feature 展示及对应测试/预览/样式。主进程、preload、IPC、会话生命周期、草稿/附件/队列/请求身份不迁。统一入口仍为 `renderer/ui`；shadcn 源码适配和 Base UI 行为藏在该 Interface 后。已有 `--ui-*` 是唯一主题权威，Tailwind 不开启全局 Preflight。

## 分阶段清单

| 阶段 | 覆盖 | 完成条件 | 状态 |
| --- | --- | --- | --- |
| 1 通用交互底座 | Select、DropdownMenu、Tabs、Collapsible；Tailwind 生产/两预览接入；Portal 主题归属 | 删除手写 ChoicePopup/焦点遍历，全部既有调用走同一实现，键盘/窄窗回归 | 待实施 |
| 2 浮层与反馈 | Dialog、Tooltip、Toast、Message、Tag/StatusBadge | 焦点锁/恢复、嵌套菜单、长内容、关闭锁、时长/暂停/队列逐项迁移或记录保留理由 | 待实施 |
| 3 表单与页面控件 | Button/IconButton、Input/Textarea、Checkbox/Radio/Switch/Slider；设置、新建/改名、任务详情、历史搜索、扩展表单 | 所有适用表单统一；保留原校验、提交/禁用/异步语义 | 待实施 |
| 4 对话与命令 | 模型 Combobox、思考 Select、添加菜单、命令面板、共享 `/` 和 `@` 建议 | 光标 token/选区、IME、Escape、方向键/Enter、选择不误发、旧请求不串会话 | 待实施 |
| 5 工作台领域组合 | Sidebar、SessionTabs、Breadcrumbs、工具详情、检查器/文件行、搜索/空错误状态 | 消费统一控件；保留文件夹/末端浮层设计；无旧重复交互 | 待实施 |
| 6 清理与验收 | 样式/旧实现/文档/测试门禁 | 迁移清单闭合、类型/构建/单测/隔离浏览器证据，列出剩余真实桌面验收 | 待实施 |

不机械替换：xterm/PTY、Markdown/源码安全渲染、Virtuoso 流式列表、Git diff 内容、会话/草稿状态 owner。ResizableWorkspace 的尺寸持久化、拖拽和 GSAP 属于领域布局能力；无行为等价方案前保留，不因组件库有 Sidebar/Resizable 名称就重写。

静态通知、标签、语义 HTML 不需要虚构 Base UI 依赖：统一样式即可。原生文本控件可以作为 shadcn 样式化原语，重点是 Interface 一致而不是禁止 HTML。

## 验证与交付

每阶段 typecheck、tests typecheck、相关行为测试、build、隔离浏览器（明暗、窄窗、焦点、键盘）。迁移前记录全量失败基线；后续对比新增失败，不删除或放宽业务断言以变绿。旧冻结 hash 与已批准 UI 迁移冲突，最终单独记录授权与更新范围，不跳过行为测试。

每阶段完成后提交并推送当前分支；推送失败停止。真实 Pi 请求、会话关闭/删除、系统文件选择器不用于自动预览验收。系统中文输入法与真实桌面交互最终人工验收单列。

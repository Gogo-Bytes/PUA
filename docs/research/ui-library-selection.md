# PUA UI 组件库选型调研

调研日期：2026-09-22。状态：**建议，尚未引入依赖或实施迁移**。范围：输入框模型选择、思考程度、添加操作及 `/`、`@` 建议；仅依据官方资料和当前仓库。

## 结论

推荐 **shadcn/ui + Base UI 行为底座**，先做隔离预览，再由用户确认生产替换。强化应集中在 PUA 的紧凑样式、业务组合和验证，不再自行重写焦点遍历、浮层定位和菜单关闭行为。

截至调研日，shadcn/ui 新项目默认 Base UI，Radix 仍受支持；官方没有要求现有 Radix 项目迁移。PUA 当前未安装两者，没有既有 Radix 投资需要保护，因此优先 Base UI 是本项目判断，不是“Radix 不稳定”的结论。[shadcn 官方公告](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)

## 当前约束与引入方式

仓库 `package.json` 使用 React 19.2、Vite 7.3，尚无 Tailwind；`src/renderer/ui` 已有 plain CSS、`--ui-*` tokens、Lucide 和 UIProvider。现有规范要求预览隔离、保留会话/附件/异步边界，不能直接整页替换。

- **完整 shadcn 方案**：官方手动安装要求 Tailwind；引入时应显式配置 Vite、别名、样式入口和 token 映射，不能仅安装一个包便宣称完成。禁止直接接受 CLI 对全局样式的覆盖。[安装说明](https://ui.shadcn.com/docs/installation/manual)
- **低侵入备选**：直接用 Base UI primitives，并参考 shadcn 的组合与视觉，以现有 CSS tokens 着色。Base UI 无内置样式，支持 plain CSS。这是“Base UI + shadcn 设计参考”，不能冒充原样引入 shadcn。[Base UI 快速开始](https://base-ui.com/react/overview/quick-start)、[样式接口](https://base-ui.com/react/handbook/styling)
- 推荐先以完整 shadcn + Base UI 为预览目标，但将 Tailwind/reset 与既有 CSS 的冲突验证作为准入条件；如无法小范围隔离，再明确采用低侵入备选。两种路径不可悄悄混用，依赖版本需锁定并实际做 React 19 构建验证。

## 输入框组件对应关系

| 场景 | 建议组件 | PUA 仍需负责的逻辑 |
| --- | --- | --- |
| 模型选择 | Base UI/shadcn Combobox，触发器为紧凑模型标签，搜索框在浮层内 | provider/model 身份、加载/失败/空状态、切换中禁重入、当前值 |
| 思考程度 | Select，无需搜索的短选项列表 | 当前模型支持的选项，模型切换后校验；不可硬编码所有模型均支持同一档位 |
| `+` 添加 | DropdownMenu（Base UI Menu） | 仅呈现已有能力；附件选择由现有宿主调用处理，不增加虚假的图片/目录入口 |
| `/`、`@` | textarea + 非模态建议层；先验证 Autocomplete/Popover 适配 | 光标 token 范围、命令/技能/路径来源、选中替换、会话隔离与 IME |

Combobox 适合从预定义集合中筛选；Base UI 官方明确不建议将它直接当自由文本搜索框。因此“模型选择可用 Combobox”不意味着“整个聊天 textarea 换成 Combobox”。[Combobox 使用指南](https://base-ui.com/react/components/combobox)

Radix 的 Select 也有明确的键盘与焦点返回约定，仍是有效备选；两套底层 API 不同，Base 的 `render` 与 Radix 的 `asChild` 不能混抄。[Radix Select](https://www.radix-ui.com/primitives/docs/components/select)、[shadcn 官方差异说明](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/rules/base-vs-radix.md)

## 焦点、浮层及中文输入的关键验收

以下为实施要求，不是第三方库自动保证的结果：

1. 模型/思考/添加菜单分别使用其正确语义；Escape 关闭并合理恢复触发器焦点。添加操作如打开系统文件选择器，应验证返回后不会被菜单延迟恢复焦点覆盖。[Base UI Menu finalFocus](https://base-ui.com/react/components/menu)
2. `/`、`@` 打开时继续让编辑器接收输入；上下箭头移动建议的活动项，不把 DOM 焦点移到一列普通按钮。WAI-ARIA Combobox 示例采用 `aria-activedescendant` 保持输入焦点，但多行 textarea 的最终角色和辅助技术支持需单独验证，不能机械套用单行示例。[WAI-ARIA Combobox 模式](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
3. token 计算同时响应文本和选区/光标变化；在句中插入只替换该范围，保留后文和选区。Escape 后不得因相同 token 立即重开；命令确认不可同时触发发送。`Command` 组件本身不提供这些领域协议。
4. composition 开始至结束期间，不消费 Enter/方向键/Escape 为建议选择或发送。保留现有 `isComposing`、composition 状态及兼容 guard，并在系统中文输入法下实测候选确认。[UI Events 的 isComposing 定义](https://www.w3.org/TR/uievents/#dom-keyboardevent-iscomposing)
5. Portal 跨出 `.ui-provider` 会改变 CSS 继承范围；明确 portal 容器并验证明暗 tokens。现有原生 modal Dialog 使用 top layer，普通 body portal 的高 z-index 不足以证明可见，必须测 Dialog 内菜单、裁切祖先、窗口底部翻转与滚动重定位。[Base UI Portal 设置](https://base-ui.com/react/overview/quick-start)

## 建议迁移顺序与完成定义

先建立隔离的模型、思考、添加菜单预览；确认 token/reset、Portal、键盘与明暗窄窗后，再替换共享 Select/DropdownMenu 的行为底座。随后统一两套 `/`、`@` 建议逻辑，但保留 Composer 的草稿快照、附件 token、提交锁与调用方状态所有权。不要在这一轮顺带替换 Dialog、消息渲染器或布局框架。

每步需真实浏览器检查鼠标、键盘、焦点返回、长名称、大列表、加载失败、窗口边缘和 reduced-motion；中文输入法另做人工确认。测试通过或换用知名组件库均不等于视觉验收通过。用户确认预览之前不接入生产 App。

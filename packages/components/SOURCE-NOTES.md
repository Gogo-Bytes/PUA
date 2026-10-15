# Sidebar reconstruction — evidence & limits

## 静态来源

目标是本机 `/Applications/ChatGPT.app` 26.1007.30912。未运行或修改目标应用。

- ASAR SHA-256：`75e397e2280dde93b70a85aa926f4282c728eacc84dfeb15ba7fb6ddd84628af`。
- REA inventory Evidence：`ev_d44527fcd437f7a9a6bae94cf4bdeee61132b1f7afa58b241c47a1099c87c939`。包中部分 unpacked native 文件存在 integrity contradiction；不将这些文件当作可信行为证据。
- 本次使用的 `webview/assets/app-initial-6350d04672d0.js` 完整 SHA：`604b5d2de4fbb41f3d0dc5b3662129c558e1c7b8aac8cc87225286f58dcfaf8f`，与成员声明匹配。
- `.map` 未随包发布，原 TSX/type/comment/项目边界不可恢复为原样。本仓库没有提交任何原 JS/CSS/SVG。

以下为该 JS 解码后字符范围 [start,end)，不是 ASAR 字节偏移，不是原 TSX 行号。

| 锚点 | 静态观察 |
| --- | --- |
| Gbs 8551601–8560746；Jis 8140500–8142044；Y4o 7839685–7842192 | 项目组、row shell、展开与嵌套 session 组合 |
| ORo 7322916–7325357 | 通用 row、aria-current、hover/active/menu-open 背景、focus-visible 处理 |
| ixs 8576164–8578276 → t4 8040036–8042279 | 项目 hover rail：More 在 new-chat 之前 |
| Tbs 8539096–8540412；Ebs 8540412–8542096 | 可选 Pin → Edit → 可选 separator/Section/reveal/worktree/connection → separator/可选 Mark-read/Archive → separator/Remove |
| h0 7394279–7395595 | 分区受 feature flag 控制；已有分区是 checkbox item，选择后关闭；末尾 New section；移动分区前 unpin |
| CZo 7659703–7671978；xZo 7658292–7659500；szo 7336472–7337815 | session rail：可选 More → Pin/移出分区 → 可保留 Archive → trailing primary；hover、focus-visible、hover:none 与 open menu 可见 |
| o0 附近 7364841；JXo 7653062–7654827 | end rail 的 52px 分支、菜单 busy/disabled 与键盘/指针焦点分支 |

## 本仓库实现选择

- React + TypeScript，Base UI 负责 DOM menu/submenu，Lucide 替代原专有图标；保留结构和交互层次，不直接搬运 bundle 的闭包、cache code、IPC 或平台 hooks。
- 约31px行高、主题颜色、圆角、菜单几何来自此前视觉研究及当前 Web 重构选择，不声称本次已取得全部原 CSS cascade、字体或 token。Base UI DOM 菜单不等于原应用的 native/DOM 分派实现。
- 原部分 row 是 div role=button；此处改为独立 native buttons，避免行选择和内部操作交叉触发。
- 原项目存在 open-project-page / toggle 行为分支；本实现按用户要求，点击项目名称切换展开并报告选择，点击文件夹只切换展开，More / 新建不改变展开。Session 不显示时间；这些是用户指定的 Web 呈现选择，而非全部原分支的逐项复制。
- 默认 session 为 Pin + Archive/Close；支持可选 More 与 retainArchiveAction。完整 session menu 的异步构造器 jJo/xXo 本次未完整解析，故不捏造固定菜单列表，由 caller 提供。
- 原归档运行中/自动化会话可能需要确认，原 Edit 有 close-auto-focus 特殊处理；此处确认、编辑器与跨目标事务归 caller，不宣称后端行为已迁移。
- 原远程主机能力、路径失效、新工作树、drag/reorder、hover card、原生右键菜单、移出分区的 pin 替代、完整 trailing primary 组合、feature flags 默认值未覆盖。组件使用显式能力数据，不猜这些宿主状态。
- Playground 的中文标签、工作/个人样例分区、fixture IDs 和内存变更是演示 adapter，不是原应用数据或后端；Finder / worktree / new-section 等仅记录意图。
- Session 多轴 resolver/indicators 的锚点与优先级见 SESSION-STATES.md；共享 Q1 的数字计数与 _zo 的 leading 分支不等于已验证的 Session 导航调用条件。按当前导航契约，未读是 boolean，所有状态使用右侧互斥槽；默认图谱为 86 个具名样本，不是所有 backend 状态/信号组合穷举。Cloud 平台/feature、Remote hostId 和 attention requests/waiting 由 caller 归一，不实现未恢复 helper。原 error asset 轮廓未知；当前 CircleAlert 是明确的 Lucide 近似，不命名为原 warning triangle。图形、chip 与 motion 不声称像素/时序一致。

## 验证

严格类型检查、package ESM/CJS/types/CSS 与 playground 生产构建通过；Node 公共包消费/SSR/时间边界断言、pnpm pack 内容检查通过。独立 reviewer 检查了 controlled contracts、standalone exports、async registry 和 Base UI seam，所报问题已修正并复核。此后本地浏览器还发现并修正了内部 pending 原生 disabled 导致的焦点丢失，复验 Pin reject/retry 与重复投影锁通过。项目子菜单两次 Escape、独立 SessionMenu、standalone rail 反馈、dark/240px 与390px窄 viewport 的 popup 位置/portal 主题已验证。完整命令与局限记于仓库 `docs/validation.md`。

本机浏览器 smoke 不代表真实 ChatGPT runtime 验证或完整无障碍认证。原字体、native 菜单、真实触摸设备/IME、跨平台、真实宿主和全部 feature branches 未认证。发布或使用任何第三方原始代码/素材仍需自行确认许可；本实现不携带这些原始资源。

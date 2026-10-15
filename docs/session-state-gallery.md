# Production promotion note

Stable contract: [package README](../packages/components/README.md). Source-decoded state types/resolver now live in `apps/playground/src/study-presentation.ts`; `toSidebarSession` maps study evidence into semantic `SessionPresentation`. The 86 named cases remain research fixtures, not required production inputs. Archived study rows are filtered by this adapter. No numeric unread/time helper is public. The inspector and caller-owned archive confirmation still use the study resolver; the package never owns archive decisions. Tests of source precedence stay in playground; package-owned public-seam tests are in `packages/components/tests`.

The historical verification below records earlier work, not a claim that the current promotion passed native browser or independent review. Parent-owned browser QA and reviewer gate remain outstanding.

# Session 状态图谱：覆盖与边界

默认 `/` 展示 **86** 个具名样本、9 类；`?view=interactive` 保留交互预览，`?view=isolated` 保留独立组件。唯一 fixture 来源是 `apps/playground/src/state-cases.ts`，组件包不导入 demo 数据。

## 本轮纠正

先前 93-case 版本错误地把共享 renderer 的数字计数能力和 leading/float 位置当成 Session 导航契约，并用 input-pill CSS 特例把状态与导航操作并排展示。现已修正：

- Session 未读只使用 `SidebarSession.unread` 布尔值，不接收 unreadCount、不显示数字/99+；删除七个不适用于 Session 的数字计数样本。数字兼容工具已删除。
- 错误、Working、未读、Pin rest、环境、语音、任务/身份、诊断均使用右侧状态槽。标题内不渲染指示图标；来源 float 信号不改变本导航位置。
- 默认显示状态，Pin/归档/More 隐藏。悬停标题或聚焦导航操作时，同一右侧槽切换为操作，状态隐藏且不可点击。没有 input-pill 并排操作特例。
- scheduled input 的 Snooze 属于状态交互，不属于导航操作。直接进入该状态或聚焦 Snooze 时保留状态、隐藏 Pin/归档；移动到标题或 Tab 到 Pin 则切换为导航操作。两栏不能同时可见。

这些是本导航的修正契约，不声称重新取证了原应用实际 DOM。共享 renderer 的静态能力与 Session 调用条件应分开，详见包内 SESSION-STATES.md。

## 覆盖 ledger

| 分类 | 数量 | 覆盖 |
| --- | ---: | --- |
| 执行/优先级 | 13 | d9n 分支与组合、Cloud publishing 与阻塞输入 |
| 未读/Pin | 6 | 单个 dot、Working/未读、error+unread、Pin/rest 抑制、child suppression |
| Attention | 12 | approval/child、blocking/MCP normalized、scheduled/Snooze、async+Working、active/indicator-only、已归一 null |
| 身份 | 9 | active voice、voice identity、automation、events、team、Aeon、environment setup |
| 创建/远程入口 | 14 | pending-start、worktree 五阶段+attention、remote 映射+unread |
| 环境/连接 | 10 | 环境、不可用及管理能力、feature/platform/host prerequisite 不展示 |
| gated 诊断 | 8 | 五种分类、feature off、latest-turn progress、no-role snapshot |
| 显示/操作 | 11 | hide、input pill、float 归一、priority、override、meta/archive-confirm、归档/恢复 |
| 进度防御 | 3 | progress 下界/上界/NaN，不是原 backend 状态 |

分类改变选取有效样本并将 main pane 回顶；投影只滚 Sidebar。fixture active 不随 inspection selection 改变。移动 Sidebar 高320px。

状态图谱的九个项目投影也传入共享 projectMenu 与 onProjectAction，More 在 hover/focus 时显示；点击菜单不展开/收起项目。项目置顶与分区在本地模拟，其余操作记录意图，分类样本不执行 Finder/归档/移除等真实项目业务；页面提示此边界。浏览器验证：修复前9项目/0 More，修复后9/9；默认 opacity=0、hover=1；打开菜单及置顶后 expanded 保持 true，焦点回到 More。

## 交互所有权

Pin、归档、Snooze、恢复仅本地内存，无 host 请求。Working/attached automation 归档使用 caller-owned native dialog；取消/Escape 保留 row。成功删除投影但保留 card 与恢复，无 Archived badge。只在焦点仍属于被移除 row 时交接，不夺取用户主动移走的焦点。单次延迟可清理，无 per-row polling/时间刷新；motion 使用 CSS 与 reduced-motion。

## 本轮验证

- 修复前浏览器复现：error 在 leading；四个数字 count badge；Needs-input 默认状态与操作同时 opacity=1。
- 新增真实 public SessionRow SSR / resolver 回归，`pnpm test:states` 初次 **9通过、2失败**；修复后 **11/11通过**，覆盖全部86样本、无标题指示图标、无数字 Session badge。`pnpm typecheck`、`pnpm build` 通过。
- 浏览器实测全部 Session badge 均在 `.pua-session-meta`，count badge=0；Needs-input 默认 status/actions opacity=1/0，悬停标题=0/1，操作为 absolute overlay。
- scheduled 状态直接悬停/聚焦 Snooze：status/actions=1/0；Tab 到 Pin：0/1。fresh URL console/network/page-errors 通过。
- 之前的归档确认/焦点交接、filter/reset、Sidebar projection 测试为历史验证，不将其等同于本轮所有交互再次认证。

## 明确边界

有限具名矩阵，不是所有信号笛卡尔积。Cloud/Remote prerequisite 只接 caller-normalized environmentVisible；T9n null 用归一样本说明，不实现 FXe/EPe 或全部 MCP DTO。owned-work/unread 聚合、feature 默认、原 glyph/chip/keyframe/timing、实际 ChatGPT runtime、host 事务/取消/持久化、真实触摸及完整 AT 矩阵未验证。scheduled progress 为静态值。

上一轮独立 reviewer 未运行：workflow d619667d-5159-424b-840c-31c7413c554f 超时，经原代理 resume 收尾成功但未自动恢复后续 review。本轮由父代理直接诊断/修复/验证，没有独立审查通过的声明，也未提交或推送代码。

# Sidebar 组件验证记录

## 正式组件验收（当前版本）

当前正式接入包为 private `@pua/components@0.1.0`；接入示例 `/?view=production`，公共 Interface / 一次性迁移见 `packages/components/README.md`。下方早期记录中的数字未读、时间工具、公共 resolver、src/development exports、93-case 等属于历史阶段，不能当作当前契约。

- 正式 Interface 为 readonly 实体、语义 execution/attention/environment/identity/notice 及注入回调；不暴露原始 runtime/source/debug 分支或私有 renderer plan。研究逻辑只在 playground adapter，当前保留86个具名样本。
- 父代理最终独立重跑 `pnpm typecheck && pnpm test && pnpm build && git diff --cached --exit-code` 全通过：8项包级公共入口/交互测试、类型契约检查、11项研究映射测试；暂存区为空。
- 独立审查及最终复查均为 **OK with notes / No issues found**，不冒充审查者执行过测试。记录：workflow `05ab8447-94a1-464f-a7d9-e6527eae6aa8` 的 production-review.md / production-final-review.md。原 `4e2823d4-2150-484c-97f9-23423273ed96` 在 writer 留下完整产物后返回 Request was aborted，已保存现场并通过同一 subagent 协议恢复余下审查；没有执行模式切换。
- 生产 tarball `/tmp/pua-sidebar-production-pack/pua-components-0.1.0-production.tgz`：SHA256 `107d2a99f6cde28f1500926e7c0073e64c1330809bef5a53c3837f590a8cc07b`。仅 README、package.json 和5个 dist 文件；无 src/研究/fixture/test。父代理独立核对 hash/文件表，并在 `/tmp/pua-sidebar-production-consumer-proof` 重跑 ESM/CJS provider SSR 与 CSS/dist resolution 通过；声明解析与archive/current-build一致性另由恢复 worker验证。
- 原生 Chrome：正式接入示例的选择、受控 Pin、菜单回调占位和关闭后焦点回到 More 通过；占位归档不删除真实数据。gallery / interactive / isolated fresh URL console/network/page-errors 通过。
- 最终 gallery：86 cards、31px行、全部 Session 指示在右侧、无 time/数字 unread，九个项目均有More。Needs-input默认status/actions为1/0，hover标题为0/1；项目More不改变展开状态、Escape回到opener。
- 深色240px：Snooze hover/keyboard focus为status/actions=1/0；指针移出仍保留已聚焦Snooze及状态；Tab到Pin切换0/1，无水平溢出。390×844桌面窄视口：sidebar高320px、86cards、无水平溢出。未将窄viewport或jsdom当真实touch/AT认证。
- 本轮截图 `/tmp/pua-production-sidebar.png`、`/tmp/pua-sidebar-production-acceptance-dark.png` 已由浏览器工具确认存在；均为本实现而非原应用runtime证据。

验收结论：可作为内部正式复用模块接入，业务确认/取消/持久化/权限/跨实例事务及移除后的焦点仍由调用方负责。无像素级一致或全AT/跨平台认证声明。未提交、推送或发布npm。

## 以下为历史阶段记录

分支：`rebuild/from-scratch`，以空仓库提交 `8ffe304` 为起点。全部为新增实现，不接 Electron / ChatGPT 服务，不包含原应用 JS/CSS/SVG。源码证据见 `packages/components/SOURCE-NOTES.md`。

## 工具与构建

- `pnpm install`：成功；初次 esbuild 安装脚本被 pnpm 12 阻止，现只在 workspace allowBuilds 中允许 esbuild 后重新安装成功。
- `pnpm typecheck`：组件包和 playground strict/noUnused 检查通过。
- `pnpm build`：组件 ESM、CJS、声明、CSS 以及 Vite production build 通过。
- 从 playground 以 Node 的普通 package resolution 导入 **dist**，ESM 七个公开组件 export、SSR 空 Sidebar、0/invalid/future 时间断言通过；CJS require 成功。
- `pnpm --filter @pua/components pack --pack-destination /tmp/pua-component-pack-check`：成功；tarball 包含 dist JS/types/CSS、src、README、SOURCE-NOTES。未发布 npm。
- 独立 reviewer 只读审查了模块、模型、异步保护、菜单和包配置；所报 disabled-project header bypass、standalone rail、空错误消息、checkbox danger、打包文档问题均已修正并由 reviewer 复核。静态审查不冒充其亲自运行浏览器。

## Chrome / 本地内存 adapter

入口 `http://127.0.0.1:4183/` 和 `/?view=isolated`。

- URL QA：console、page-errors、network 通过。初次 favicon 404 已增加本项目自制 SVG，重新导航通过，无外部业务资源请求。
- 1440×1000 明色、深色 / 240px sidebar 已查看截图；所有行 DOM 高度 31px，无页面水平溢出。
- 项目 More → 分区子菜单正常；checked item 在 accessibility tree 是 menuitemcheckbox。第一次 Escape 关闭子菜单并回到“分区”，第二次关闭主菜单并回到“PUA 更多操作”。
- standalone SessionMenu Escape 正确回到自己的 opener；无重复 DOM IDs。
- standalone SessionActions 在无 Sidebar/row 包裹时 opacity=1、position=static；拒绝回调显示“独立操作失败反馈”。
- 独立 SessionRow 显示 More → Pin；默认隐藏 Archive，retainArchiveAction 样本显示 More → Pin → Archive。
- 同 session 同时投影在项目和最近：同步触发两个 Pin，callback 开始记录只增加一次，两处共享 aria-disabled / row busy。拒绝后保持受控 pin，显示两处行级反馈；关闭模拟拒绝重试后两处一致更新、错误清除。
- 初次 Pin pending 原生 disabled 实测使焦点落到 BODY；已改为内部 pending 用 aria-disabled + registry 同步锁拦截，外部能力禁用仍为原生 disabled。复验 waiting、reject 和 success 均保留原操作 button 焦点。
- 失败请求期间将投影模型切空并重新加入：移除时 rows=0，重加同 ID 暂时保留旧 pending 锁，旧失败 settle 后无旧 alert 写入新行，pin 未改变，锁释放。外部 adapter 审计日志仍保留失败事件，符合独立业务所有权。
- 390×844 **桌面浏览器窄视口**：document scrollWidth=390；侧栏364px、31px行，footer仍在可见区域。dark 项目 popup 位于 x111–337/y456–712，未越 viewport，portal 继承深色背景。

## 本机生成截图（不提交）

- `/tmp/pua-monorepo-sidebar-light.png`
- `/tmp/pua-monorepo-project-menu.png`
- `/tmp/pua-monorepo-sidebar-dark-narrow.png`
- `/tmp/pua-monorepo-mobile-menu.png`
- `/tmp/pua-monorepo-isolated.png`

均由浏览器工具确认文件存在。它们是本实现截图，不是原应用 runtime 证据。

## 后续交互调整

按用户要求，项目文件夹 hover/focus 不切换箭头；项目名称和文件夹均可点击展开/折叠，More / 新建保持独立。Chrome 实测点击 agent-pet 名称两次：aria-expanded false→true，子列表 hidden true→false；DOM 中不再有 disclosure 箭头。

Session 已移除全部时间呈现（含 label/title），Sidebar/SessionRow 不要求时钟或 formatter，timestamp 仅保留可选 metadata；浏览器 `.pua-sidebar time` 数量为0，Session accessible names 不含日期，Playground 不再有刷新时间的 interval。最新截图 `/tmp/pua-monorepo-sidebar-no-time.png`。该次改动后的 typecheck、组件+playground 构建及 URL QA 的 console/network/page-errors 通过。独立时间工具仍导出，但不参与 Session UI；上方时间断言属于工具验证，不代表当前行显示时间。

Session 状态指示链的静态追踪与 Web 多轴重构见 `packages/components/SESSION-STATES.md`。当前默认入口为状态图谱；原交互入口改为 `?view=interactive`，standalone 仍为 `?view=isolated`。93 个具名 fixture / 9 类及检查边界见 [覆盖 ledger](session-state-gallery.md)。公共 resolver/全 fixture SSR tests、typecheck、生产构建通过；不加入 completed/draft 猜测。

Parent 对 87-case 中间版已完成 console/network/page-errors、31px、无重复 ID、count优先/error+unread/voice/debug、Snooze、归档取消焦点恢复/确认删除并保留恢复、remote unavailable 管理意图、dark 240px/390×844 无水平溢出、interactive/isolated QA。新增6个归一 gate/null 样本以及删除后焦点交接、分类 scroll reset、gallery-only mobile 高度调整已实现，需最终浏览器复验。中间截图 `/tmp/pua-state-gallery-{light,dark-narrow,mobile}.png` 不代表这些后续改动已实测。

## 边界

未运行真实 ChatGPT runtime、Electron/原生菜单、真实触摸设备、系统 IME、屏幕阅读器/全无障碍认证或跨平台矩阵。窄 viewport 不等于真实移动触摸测试。没有验证或实现真实权限、确认、磁盘、远程连接、Git/worktree、持久化和 host cancellation/versioning；示例仅内存状态。Package 的单实例 mutation 锁不保证跨实例或 project bulk/session 的多目标业务事务。

没有像素级一致承诺；源映射缺失，保留的是已追踪布局/操作关系与 Web 中重新实现的交互，不是恢复原 TSX 项目。

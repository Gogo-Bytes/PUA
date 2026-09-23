# 工作台交互修订（2026-09-22）

## 2026-09-23：把资源授权移到实际启动时

默认草稿不再自动扫描或显示占位资源卡片；`@` 和 `/` 仍按需加载候选。首次发送前检查项目资源：没有资源时直接启动；发现资源时保留草稿并显示紧凑选择，用户明确选择沿用 Pi 决定、本次信任加载或本次不加载后才启动。检查失败会留在输入框报错并允许重试。新建会话弹窗采用同一启动边界，空白路径在提交层拒绝。这样保留 Pi 项目资源的安全授权要求，同时移除默认输入框上方的大块预检卡片。

新对话模型/思考选择已接入；Files 已完成只读目录浏览及 256 KB UTF-8 文本预览；Browser 已接入独立会话的 Electron WebContentsView 与受限导航控制。Terminal、Side chat、分支操作、subagents/后台进程仍需真实宿主能力接入，不能把入口存在描述为功能已完整交付。

## 截图补充后的实施

用户已提供五张截图，确认项目行“更多/新建”、会话行“钉选/归档”、独立 Environment 浮窗、多标签右侧面板和 Review 多文件连续 diff。第一阶段已按图改侧栏：更多菜单使用已有共享 Menu，承载实际可用的打开目录、复制路径、兼容终端；Chat 使用 archive 图标与归档名称。已核对后端 closeSession 确实在进程关闭后持久归档，取消/失败不移除条目；Terminal 不具备持久历史归档，仍明确叫关闭。项目空组的打开目录受 session-id 接口限制而禁用，不临时创建会话。侧栏浏览器回归及类型检查通过。

第二阶段已分离独立环境浮窗与右侧标签宿主；通过 research 技能核对三个候选后选用锁定版本 @pierre/diffs 1.4.3，替换手写 diff 行。Review 连续展示多个文件，右侧支持标签打开/切换/关闭、会话隔离与空白入口。既有未接入能力显示明确状态，不虚构 Git 操作、subagents 或后台进程。

用户提出 9 项修订。前一阶段落实 2、3、4、9；当前落实截图补充后的侧栏、独立浮窗、多标签宿主和 Review 展示。未声明完整复刻 Codex 所有后台能力。

## 已实施

- 新建/已有会话 Composer 删除发送按钮左侧快捷键说明。
- 已有会话底栏删除压缩/统计按钮；`/compact [要求]`、`/stats` 通过建议插入，提交时调用现有 typed API，不作为模型 prompt。保持 IME、发送锁、busy 检查、失败草稿、等待期 revision 与附件保护。
- 移除生产项目/会话过滤输入框，保留顶部搜索入口。
- 移除通用焦点 outline、Composer 整体焦点框和按钮按下 inset shadow。键盘使用无外框的文字/图标反馈；菜单选中态仍保留。

验证：main/renderer/tests 类型检查、生产构建通过（已有 chunk 警告保留）；Composer/Pending/新增本地命令 21 项通过，原 compact/stats 的两项测试按 slash 操作更新。隔离生产浏览器 `tests/composer-cleanup-check.mjs` 覆盖新建/已有会话、命令建议与统计弹窗、压缩、点击样式、无过滤框及 1440/500px 布局。未调用真实 Pi/Git、系统选择器或重启用户 Electron；本轮未重跑全量测试。

## 未完成与所需信息

本次截图阶段验证：70 项 UI/Git/保护清单专项 + 24 项真实 App workspace 回归通过；production/tests/preview 类型、import boundaries、56 项保护清单及生产构建通过。独立浮窗、标签键盘与关闭焦点、浅深色、700px 响应式、无外网请求通过；构建后的 Fake Desktop 使用生产 CSP 同样通过。原工作台浏览器脚本另外覆盖 360–1440px、草稿/附件、引用和面板收放。没有运行真实 Pi/Git 或重启用户 Electron。全量结果另列下方，不将专项等同于全量通过。

全量 Vitest：2695 passed / 16 failed；与先前 `/tmp/pua-ui-final.json` 的 2672 passed / 24 failed 对比，剩余失败身份均在旧基线，未增加新的失败身份。剩余集中在 App 静态 ownership/旧控件查询、command-palette 和 settings 既有断言。并非全量绿灯，也不能仅凭失败身份相同证明所有旧场景无回归。构建保留 chunk-size 警告；DiffSurface 单独懒加载，本地语法 chunks 已产出。

1. 新建会话模型/思考控件已实施：按需经 Desktop IPC 使用 Pi 自己的离线 `--list-models`，传入 `--no-session`、`--no-extensions` 并固定在 home cwd，不启动会话或扫描项目资源；首次创建 Chat 时将所选项作为 schema 校验后的 argv 初始参数。Pi 不可列出模型时仍可发送并使用 Pi 默认值。思考等级使用 Pi CLI 支持的全局枚举；无 reasoning 能力的模型会禁用该选择。定向 IPC、Pi adapter、Pending composer 与 Session 启动测试及生产构建通过；真实 Electron/Pi 首条请求仍需桌面验收。
2. 用户提供的五张截图已经解除第 5–8 项的视觉参考阻碍。不需要也没有绕过计算机工具对 `com.openai.codex` 的限制；参考来自附件，不是实时访问原应用。
3. 右侧 Files 已实现会话目录浏览与受限文本预览；Browser 已由主进程隔离 WebContentsView 承载，限制 HTTPS/loopback HTTP、权限、下载和新窗口。Terminal/Side chat、分支操作、提交推送、subagents/后台进程仍待接入。完整 unchanged 展开需要新的两侧内容授权接口，当前变更不含这些内容。
4. 分支操作/subagents 等未实现能力应明确显示“未接入”及原因，不可使用成功假反馈或把会话关闭冒充归档。保留现有 Session、Git snapshot、草稿和附件 owner。

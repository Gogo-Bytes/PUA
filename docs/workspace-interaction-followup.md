# 工作台交互修订（2026-09-22）

## 截图补充后的实施

用户已提供五张截图，确认项目行“更多/新建”、会话行“钉选/归档”、独立 Environment 浮窗、多标签右侧面板和 Review 多文件连续 diff。第一阶段已按图改侧栏：更多菜单使用已有共享 Menu，承载实际可用的打开目录、复制路径、兼容终端；Chat 使用 archive 图标与归档名称。已核对后端 closeSession 确实在进程关闭后持久归档，取消/失败不移除条目；Terminal 不具备持久历史归档，仍明确叫关闭。项目空组的打开目录受 session-id 接口限制而禁用，不临时创建会话。侧栏浏览器回归及类型检查通过。

第二阶段将分离独立环境浮窗与右侧标签宿主，diff 展示库由 research 技能后台核对官方资料后选型；既有未接入能力会显示明确状态，不能虚构 Git 操作、subagents 或后台进程。

用户提出 9 项修订。当前阶段只落实无需额外视觉参考的 2、3、4、9；不声明已复刻 Codex。

## 已实施

- 新建/已有会话 Composer 删除发送按钮左侧快捷键说明。
- 已有会话底栏删除压缩/统计按钮；`/compact [要求]`、`/stats` 通过建议插入，提交时调用现有 typed API，不作为模型 prompt。保持 IME、发送锁、busy 检查、失败草稿、等待期 revision 与附件保护。
- 移除生产项目/会话过滤输入框，保留顶部搜索入口。
- 移除通用焦点 outline、Composer 整体焦点框和按钮按下 inset shadow。键盘使用无外框的文字/图标反馈；菜单选中态仍保留。

验证：main/renderer/tests 类型检查、生产构建通过（已有 chunk 警告保留）；Composer/Pending/新增本地命令 21 项通过，原 compact/stats 的两项测试按 slash 操作更新。隔离生产浏览器 `tests/composer-cleanup-check.mjs` 覆盖新建/已有会话、命令建议与统计弹窗、压缩、点击样式、无过滤框及 1440/500px 布局。未调用真实 Pi/Git、系统选择器或重启用户 Electron；本轮未重跑全量测试。

## 未完成与所需信息

1. 新建会话底栏缺少模型/思考控件的原因已确认：PendingChatPane 没有 footerControls，且 getChatAvailableModels/getChatThinkingLevels 均要求 session id。不能用临时真实会话、硬编码模型列表或虚假按钮掩盖。需要补充不依赖会话的配置目录与首发前参数应用设计；本阶段不改 IPC、进程和会话创建时机。
2. 第 5–8 项等待 Codex 项目操作菜单、session 操作菜单、右上角浮窗、Changes 和右侧标签栏截图。计算机工具明确禁止访问 `com.openai.codex`，不改用其它方式绕过，也不声称看过目标。用户当前输入框截图不足以确定这些区域的功能、层级与视觉。
3. 后续右侧应是多标签面板宿主，Changes 只是其中一类。待参考明确后再实现；不能把本阶段未修改的 Git 专用容器当目标完成。
4. 分支操作/subagents 等未实现能力应明确显示“未接入”及原因，不可使用成功假反馈或把会话关闭冒充归档。保留现有 Session、Git snapshot、草稿和附件 owner。

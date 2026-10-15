# Session 状态呈现：静态逆向结果

## 范围与结论

已追到正常 session、待创建、工作树创建、远程任务及多个辅助状态的 UI 渲染链。**它不是单一枚举，而是执行状态 + attention + unread + 环境/身份 + 附加能力的组合。**

目标：`/Applications/ChatGPT.app` 26.1007.30912；成员 `webview/assets/app-initial-6350d04672d0.js` 的 SHA-256 再次验证为 `604b5d2de4fbb41f3d0dc5b3662129c558e1c7b8aac8cc87225286f58dcfaf8f`，匹配 ASAR 声明。仅读取/静态追踪，未运行原应用、调用服务或复制原图标。

下列锚点是该成员的 **解码字符偏移**，不是 ASAR 字节或原 TSX 行号。

## 正常 session

| 已确认条件 | 原版呈现 | 来源 |
| --- | --- | --- |
| 执行中 / 有 owned work / response in progress | loading，Working spinner，role=status；Cloud publishing 也可强制 loading | d9n 2794583–2794862；f9n 2794912–2795528；LRo 7327070–7327679 |
| 无执行、错误等条件 | idle；通常没有默认状态图标，**未观察到完成勾号** | d9n；Q1 7325627–7326056 |
| 系统/最近 turn 错误 | error；符合显示条件时在前部显示 danger 色图标；可与后部未读点并存 | _zo 7338177–7351177；YOe 的 SVG 轮廓未解码 |
| unreadCount > 0 | 圆角数字 badge，最多显示 99+ | FRo 7326056–7326693 |
| unread=true，非 loading，且无 count | info 色实心小圆点；不是“已完成” | IRo 7326693–7327070 |
| 待审批 / 子线程待审批 | Awaiting approval chip | oqo 7544222–7558019 |
| 阻塞输入，非当前 active row，非 attentionIndicatorOnly | Needs input 状态 pill；scheduled autoResolution 可有期限进度与 Snooze 操作 | oqo；Szo 7358263–7360379 |
| 非阻塞异步输入 attention，非 active row | Needs input chip；可能仍同时显示 Working | oqo；attention.source=userInputAsync |
| 活跃实时语音 | Voice chat active 的 info 色呼吸圆点，可覆盖常规状态显示 | cXo 7637513–7638357；CZo 7659703–7671978 |
| automation run / attached automation | Scheduled task run / Scheduled task attached 图标 badge；与执行状态分开 | oqo；CZo |
| pin / event subscriptions / team/voice 身份 | 各自附加指示，不是执行状态枚举 | fHo 7423967–7424247；vZo 7658069–7658292；CZo |

info/danger 是原样式语义；没有据此承诺所有主题的精确 RGB 或图标轮廓。

### 基础状态优先级

`d9n` 的判定次序（不是根据产品常识推测）：

1. owned work → loading。
2. runtime summary 的 systemError → error。
3. runtime active → loading。
4. needs_resume → idle。
5. latest-turn error → error。
6. response in progress → loading。
7. 其他 → idle。

Cloud publishing 可将基础结果强制成 loading。阻塞输入、attentionIndicatorOnly 会抑制部分 loading；异步输入走另一条分支，不必停止 spinner。

### 显示优先级与共存

- Q1：unreadCount 优先于 loading spinner；非 loading 的 unread 点随后；普通 idle 不显示默认指示。
- _zo：statusIndicatorOverride 高于 status pill/default Q1；status pill 高于默认 Q1，只有通用 Q1 使用 !hideStatusIndicator gate。前部 priority indicator 高于 error 图标，后者高于 idle/pin rest。
- Awaiting approval chip 优先于**异步输入 chip**；不能简化为“所有输入状态都被审批覆盖”。阻塞输入 pill 有独立条件。
- active row、attentionIndicatorOnly、child/thread/team-room、hideStatusIndicator、float-status、status/meta 替换都会影响最终位置/可见性。
- 未读、错误、执行状态可组合；不能把“未读”推断为“执行完成”。动作菜单自己的 pending 也不等于 session 的 Working。

## 其他入口/辅助分类

| 路径 | 实际映射/呈现 |
| --- | --- |
| Pending thread start | failed / outcome-unknown → error；其他到达此分支的值 → loading。没有据此确认 Draft badge。Q$o 7730689–7733769 |
| 工作树初始化 | queued / creating / setting-up → loading + 脉动环境图标；failed → error，标题 Worktree init failed；worktree-ready → idle。Oer 2808490–2808614；RZo 7681786–7685182 |
| 远程 task | latest turn in_progress / pending → loading；failed → error；其他 → idle；独立 has_unread_turn。jZo 7673542 起 |
| 不可用远程主机 | disabled/隐藏 quick actions，菜单可显示 Remote host unavailable / Manage connection；未确认独立“离线状态图标”。n1o 7734334–7748683 |
| 环境类型 | remote / remote-worktree / worktree / cloud 使用环境图标，不能当作执行状态。n0 7334965–7336401 |
| 可选订阅诊断 | gated feature 下有绿色 active、紫色 follower、黄色 idle、红色 Needs resume、橙色 Read-only snapshot 的小点；**不是默认五种 session 状态**。mXo 7638492–7639183；hXo 7639183–7639436 |

成功归档后普通 row 会被移除；archive 图标是操作，不是“已归档”状态 badge。活跃执行/附加 automation 的归档可能需要确认，这属于 caller 的真实业务。

## 渲染链与未确认项

`n1o` 选择入口 → CZo 收集身份/操作 → oqo 汇合执行/attention/unread/环境 → Hzo → _zo 组合前后部指示与 pill → Q1 选择 count/spinner/dot。xZo/szo 则是 **hover 操作栏**，不可混为状态 renderer。

仍未完整恢复：部分 owned-work / unread 聚合、Bf、FXe/EPe 等 helper，feature flag 默认值，chip 下游全部样式，spinner/进度动画精确 keyframe 与时间，原 SVG 轮廓，真实 runtime 与跨平台表现。

未建立证据的状态包括通用 complete/success/checkmark、Draft、任意后台任务的独立 badge。不能凭名称自行增加。

## 共享 renderer 与 Session 导航的区别

上面的数字 unreadCount / 99+、leading / float 位置描述来自共享 renderer 的静态分支，不能直接推广为每个 Session 的实际 UI。此前 demo 错把通用能力当成 Session 调用契约。本导航按用户反馈修正为：Session 只有布尔未读；所有状态/环境/身份指示统一右侧；Pin/归档操作栏替换状态栏，不并列。scheduled input 的 Snooze 属于状态交互，针对该状态操作时隐藏导航操作栏。此布局修正不是新的原应用 runtime 取证结论。

## 当前组件实现边界

当前 `SessionPresentation` / `resolveSessionPresentation` / `SessionIndicators` 已实现 caller-normalized 多轴呈现，并接入 SessionRow。默认 Web 图谱包含 86 个具名场景、9 类及真实 Sidebar 投影；原交互 demo 保留在 `?view=interactive`。无 presentation 时继续使用 statusLabel fallback，无时间与 hover disclosure 箭头。

Cloud 环境图标已知 gate 是 !oj + supported Electron/extension/chromeExtension；Remote glyph 需要 hostId。Web 用可选 `environmentVisible` 接收 caller 归一的显示结果，提供各项不展示的样本，不把环境隐藏误作整行隐藏。T9n 的缺失 requests/resume、needs-resume 未活跃等待路径由 caller 归一为 attention 不存在；有说明样本但**不声称实现完整 T9n / FXe / EPe 或全部 MCP form backend 解码**。

几何、SVG 轮廓和 motion 仍是 Lucide/CSS 近似；scheduled 进度是静态值，Snooze 仅内存意图。归档确认和 row 删除属于 demo owner，取消不移除；删除时只在焦点仍位于被移除 row 时交接给恢复/邻近控件。resolver 测试通过公开包导出，浏览器验证不等于原应用 runtime 验证。覆盖分类、遗漏与检查入口见仓库 `docs/session-state-gallery.md`。

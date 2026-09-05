# 0.1.0 验证记录

验证环境：macOS arm64、Node.js 22.22.3、Electron 44.2.0、本机 Pi 0.84.4。实际执行日期：2026-09-05（本机时钟）。

| 项目 | 结果 / 证据 |
|---|---|
| `npm run typecheck` | 通过：main/preload/shared 与 React renderer |
| `npm test` | 通过：8 项，覆盖背压、组合 Enter、文件引用编码、CLI 参数不经 shell、缺失安装、桌面设置校验/原子保存 |
| `npm run test:desktop` | 通过：真实 Electron 和 node-pty，不是网页 mock；Pi 进程使用无网络 fixture |
| `npm run test:pi` | 通过：真实已安装 Pi；临时 agent/profile/project；不调用模型、不修改已有配置 |
| `npm run package` | 通过：生成 `release/mac-arm64/Pi Desktop.app`，未签名、默认 Electron 图标 |
| 打包产物集成测试 | 通过：`PI_DESKTOP_TEST_EXECUTABLE="$PWD/release/mac-arm64/Pi Desktop.app/Contents/MacOS/Pi Desktop" node scripts/smoke-desktop.mjs` |
| 依赖安装审计 | npm install 报告 0 vulnerabilities；不是独立安全审计 |

## 桌面集成测试覆盖

- 启动窗口、renderer 无 Node `require`。
- 真实 PTY 和 utility process，中文/空格 cwd，含 shell 元字符的 argv 原样传递。
- 中文多行草稿的 bracketed paste，以及 Shift+Enter 正确编码。
- 命令面板只插入 `/model`，不偷偷添加回车执行。
- 两个独立会话；后台标签消费 15,000 行输出后仍完成，无背压死锁。
- 切换标签、终端搜索、正常进程退出、关闭已退出标签。
- renderer 拒绝 `file:` 外部协议；未出现未处理页面异常。

## 真实 Pi 测试覆盖

加载 Pi 自带 `examples/extensions/modal-editor.ts`，验证自定义编辑器 `INSERT → NORMAL → INSERT` 转换，再打开 Pi 原生 `/settings`，最后 `/quit` 正常退出。该能力在 RPC 文档中明确降级，因此是终端路线的一条具体兼容证据；不是全部扩展已兼容的证明。

修复了测试实际暴露的问题：Electron ESM 顶层 await ready 导致启动死锁；图片 addon WASM 受 CSP 阻止；测试发送 Escape 后未等 Pi UI 切换造成组合输入竞态。

## 尚未验证

- Windows / Linux / macOS x64 打包与真实运行；签名、公证、安装/升级、杀毒兼容。
- 付费模型执行、真实 OAuth 完整授权、图像剪贴板到模型、IIP 图片显示专项、完整 IME 候选定位。
- 用户现有所有扩展及其额外依赖、外部编辑器、完整增强键盘协议、脱离 PTY 的第三方子进程。
- 原生聊天 GUI、结构化业务状态/工具卡片不在 0.1 的实现范围。
- 外部官网在线调研尚未完成；研究报告已标记依据来自本机官方文档和包内类型/README。

构建仍有大 chunk 提示（renderer 包含 xterm 与 React，约 632KB 未压缩）；未将提示隐藏，也未以未测量的拆包收益作性能承诺。

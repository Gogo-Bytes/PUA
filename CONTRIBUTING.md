# 参与 PUA 开发

PUA 是独立于 Pi 安装与凭据的 Electron 桌面应用。开始前请阅读 [README](README.md) 的依赖、运行与已知边界；本仓库以 macOS arm64 为优先实机验收平台，CI 在 macOS、Windows 和 Linux 上构建与运行离线测试。

## 本地运行与检查

使用 Node.js 22.19+、npm 和本机 Pi。当前协议测试基线是 Pi 0.85.1；安装方式见 [README](README.md#开始使用)。

```bash
npm ci
npm run dev
```

提交代码前运行与改动相关的检查。完整代码门禁为：

```bash
npm run verify
```

`npm run test:desktop` 使用离线 Pi fixture 启动真实 Electron；`npm run test:pi` 使用本机已安装的 Pi 和隔离配置，不调用付费模型。两者分别覆盖桌面集成与 Pi 兼容路径，不能替代真实登录、模型或系统输入法的人工验收。自行构建应用目录或安装包使用 `npm run package` / `npm run dist`；两条命令都会先运行完整门禁。

## 修改范围

- 跨模块功能、进程边界、IPC、状态所有权或目录调整，先读[目标架构](docs/target-architecture.md)，再以当前代码和测试核对文档。
- UI、主题、动效或工作台修改，先读[组件库原则](src/renderer/ui/README.md)与[生产接入契约](src/renderer/ui/production-integration.md)。组件预览只使用隔离数据，不接入真实 Pi、Git 或磁盘。
- 保留 Pi 原有模型、凭据、技能、扩展与会话文件的所有权；不要把 TUI 专属能力伪装成 RPC 功能。
- 改编第三方代码时保留原版权和许可声明。PUA 原创代码使用 [MIT 许可证](LICENSE)。

提交问题或改动时，请附上操作系统与架构、Node.js/Pi 版本、复现步骤、预期与实际行为，以及运行过的检查。不要附上 API key、Pi 凭据或真实会话内容。

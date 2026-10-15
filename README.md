# PUA · Sidebar module and studies

从桌面应用的已发布产物中分析交互，再独立实现可复用的 Web 组件。**不是 OpenAI 原始源码、官方组件库或完整桌面应用移植。** 仓库不包含原应用 bundle / CSS / SVG。

## 开始

开发/测试：Node.js 22.22.2+（22.x）或 24.15+（24.x）或 ≥26，pnpm 12.4.2。jsdom 30 的 CSS focus/rail 回归需要此开发工具版本；组件包本身不包含 jsdom。

```sh
pnpm install
pnpm dev
```

- 默认状态图谱：http://127.0.0.1:4183/ （86 个具名场景，9 个分类；Session 未读为布尔状态，所有状态统一右侧，悬停操作替换状态）
- 正式消费示例：http://127.0.0.1:4183/?view=production （只使用公共包导入；业务命令为显式占位）
- 原交互预览：http://127.0.0.1:4183/?view=interactive
- 独立组件样本：http://127.0.0.1:4183/?view=isolated
- `pnpm typecheck`：所有 workspace 的严格类型检查。
- `pnpm test`：包内公共契约/SSR/交互/类型测试 + playground study matrix。
- `pnpm test:states`：只验证研究映射和全部 fixture。
- `pnpm build`：先生成组件 ESM / CJS / declarations / CSS，再构建 playground。
- `pnpm preview`：预览已构建的 playground。

仅允许 esbuild 必需的安装脚本，配置在 `pnpm-workspace.yaml`；未放开任意依赖脚本。

## 结构

```text
apps/playground/       # React + Vite；内存 adapter、示例数据、交互检查器
packages/components/  # @pua/components；唯一可复用组件实现
  src/provider.tsx    # 局部主题与菜单 portal 容器
  src/sidebar/        # Sidebar / rows / menus / action rail / contracts
  src/styles.css      # .pua-ui 作用域样式与主题 token
  README.md           # 接入、受控数据与异步所有权
  SOURCE-NOTES.md     # 已观察证据、实现选择、尚未覆盖的分支
```

第一批导出：`Sidebar`、`ProjectRow`、`SessionRow`、`ProjectMenu`、`SessionMenu`、`SessionActions`、`UIProvider`。

包的正式 Interface 仅接收语义 UI 状态；source/runtime/订阅诊断映射在 playground 内，研究文档不是生产契约。dist-only 导出，Vite dev 显式 alias 保持 HMR，pack 不携带源码/研究/测试。

组件包不依赖 playground，也不调用 ChatGPT 服务、Electron、文件系统、Git 或其他宿主接口。Pin / Archive / Remove 等操作通过具名回调交给调用方；示例 adapter 只修改内存。Finder、工作树、新分区、搜索、命令、设置只记录意图，不假装已执行真实业务。

状态覆盖清单、caller 归一边界与测试入口见 [状态图谱说明](docs/session-state-gallery.md)。

接入见 [组件包文档](packages/components/README.md)，来源与边界见 [证据说明](packages/components/SOURCE-NOTES.md)，实测范围见 [验证记录](docs/validation.md)。当前包为 private workspace，不代表已获得第三方原始代码/素材的再发布许可。

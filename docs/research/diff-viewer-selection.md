# Review 差异查看器选型

调研日期：2026-09-22。范围：只读 React 19 / Electron / Vite 展示，不安装依赖，不修改生产代码，不扩张 Git/IPC 权限。

## 结论

推荐锁定 **`@pierre/diffs@1.4.3`**，在 UI 层封装只读差异表面，由 change-review feature 提供已授权的 patch。其 unified 行、双侧行号、文件标题与增删统计、Shiki 语法着色、行间分隔和虚拟化更接近用户提供的 Review 截图。不是 Monaco 编辑器，也不引入可执行预览或编辑能力。[官方 README](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/README.md)

当前 patch 数据只有 `FileDiff { text, kind, truncated }`；查看器不能从 patch 推断省略的 unchanged 内容。生产已补上 `fileDiffContents` 两侧内容加载接口：它先按最新 Git 成员快照授权，再由 main/Git Adapter 返回两侧文本；Pierre 的 `loadDiffFiles` 通过该宿主接缝展开内容，失败时保留原 patch。[官方 React API 示例](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/ReactAPI/constants.ts)

## 比较

版本和 peer 信息通过 npm registry 的 `npm view … version license peerDependencies --json` 当日核实；不是 GitHub main 的推测版本。

| 库 | 当前版本 / 许可证 / React | 适配判断 |
| --- | --- | --- |
| `@pierre/diffs` | 1.4.3 / Apache-2.0 / `^18.3.1 || ^19.0.0` | 首选。直接解析 patch；Shiki、主题、折叠分隔、虚拟化接口齐全；Shadow DOM 需专门 token 映射。 |
| `@git-diff-view/react` | 0.1.7 / MIT / React 16.8–19 | 可行备选。支持 hunks-only 数据、unified、主题、高亮、Worker、SSR；需自行组织多文件容器。普通样式与 Tailwind 可能相互影响，可用 pure CSS 入口。 |
| `react-diff-view` | 3.3.3 / MIT / `>=16.14.0` | API 成熟、patch 驱动；高亮需额外配置 refractor，折叠扩展也需原文；大列表与折叠布局需要更多自行组合。 |

出处：[Pierre package](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/package.json)、[git-diff-view 官方发布说明](https://www.npmjs.com/package/@git-diff-view/react)、[react-diff-view package](https://github.com/otakustay/react-diff-view/blob/master/package.json)。git-diff-view 的 pure CSS 入口为 `@git-diff-view/react/styles/diff-view-pure.css`；其数据类型允许仅提供 `hunks: string[]`，`oldFile/newFile.content` 可缺省。[官方包文档](https://www.npmjs.com/package/@git-diff-view/react)

react-diff-view 的 `parseDiff` / `Diff` / `Hunk` 可组合多文件；`tokenize` 缺少 oldSource 时，多行字符串/注释的着色可能不准确。这同样提醒我们：patch-only 的语法上下文始终有限，不能把高亮当作语义分析。[官方 README](https://github.com/otakustay/react-diff-view)

## 最小接入形态

以下是 API 核实后的接入示意，尚未安装、编译或进行本仓库运行验证。实际封装应添加应用级 ErrorBoundary，并保持 renderer 不自行读磁盘。

```tsx
import { useMemo } from 'react';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff, Virtualizer } from '@pierre/diffs/react';

export function PatchPreview({ text, themeType }: {
  text: string;
  themeType: 'light' | 'dark';
}) {
  const parsed = useMemo(() => {
    try {
      // 第三个参数启用严格失败；不把部分解析成功冒充完整结果。
      const files = parsePatchFiles(text, undefined, true)
        .flatMap(patch => patch.files);
      return files.length ? files : null;
    } catch {
      return null;
    }
  }, [text]);
  const options = useMemo(() => ({
    diffStyle: 'unified' as const,
    diffIndicators: 'bars' as const,
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
    themeType,
    preferredHighlighter: 'shiki-js' as const,
    hunkSeparators: 'line-info' as const,
    overflow: 'scroll' as const,
    tokenizeMaxLineLength: 1000,
    maxLineDiffLength: 1000,
  }), [themeType]);

  if (!parsed) return <pre>{text}</pre>;
  return (
    <Virtualizer style={{ height: '100%', minHeight: 0 }}>
      {parsed.map((fileDiff, index) => (
        <FileDiff key={`${index}:${fileDiff.name}`}
          fileDiff={fileDiff} options={options} />
      ))}
    </Virtualizer>
  );
}
```

`parsePatchFiles` 返回 `ParsedPatch[]`，每项 `files`；不要把多文件 patch 塞给只接受单文件的 `PatchDiff`。`FileDiff` 接受预解析元数据。示例故意不提供持久 cacheKey，防止同一路径更新后错误复用旧内容；需要缓存时，键必须含修订或内容版本。[解析源码](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/utils/parsePatchFiles.ts)、[PatchDiff 源码](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/react/PatchDiff.tsx)

### 数据分流与降级

- `kind=diff && !truncated`：严格解析；不支持的 combined conflict patch、解析失败或空元数据用 React 文本节点原样展示，不能丢失内容。
- `truncated=true`：明确显示“部分内容”；优先原始文本兜底，不能伪造末尾行号或全文件计数。
- `untracked`：可用同库 `File` 展示带行号文本，但不得声称这是已跟踪文件的完整 Git patch。
- `binary/symlink`：保留现有信息态，不能读取符号链接目标补齐预览。
- 多文件加载归 change-review 管理：同一 review 请求身份、切 session 清理结果、有限并发与懒加载；虚拟 DOM 不等于网络/IPC 请求也受限。

以上是对本仓库 `src/shared/ipc/change-review.ts` 和 `src/platform/git/review-adapter.ts` 的集成判断，不是第三方库自带能力。

## 性能、样式和宿主限制

**虚拟化。** `Virtualizer` 自身就是滚动容器，需要确定高度；避免再套同方向内部滚动。其顶层文件容器仍全部挂载。纯代码的大文件列表可进一步使用 `CodeView`，官方认为它比混合 DOM 的 Virtualizer 更优；这不是第一步必需条件。修改字体、行高时同时校准 metrics。大文件还应考虑 worker，而非仅凭虚拟化宣布性能已解决。[官方虚拟化文档](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/Virtualization/content.mdx)

**Shadow DOM。** 外部 Tailwind 类不会直接覆盖内部行。优先映射 `--diffs-font-family`、`--diffs-font-size`、`--diffs-line-height`、header 字体和增删色变量，并显式传入应用的 `themeType`，不要跟随 OS 导致应用浅色、代码深色。避免 `unsafeCSS`；官方明确其内部选择器连 patch 版本也不承诺稳定。若不得不用，只能写死可信 CSS，不得把 patch 或文件名拼进去。[样式文档](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/Styling/content.mdx)、[可用变量](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/Styling/constants.ts)

**离线与安全。** 默认高亮引擎为 `shiki-js`；语言来自本地依赖的 `bundledLanguages` loader，不需要 CDN。Vite 构建仍须验证所有动态语言/主题 chunks 打包进产物。展示数据只能走源码字符串/React 文本，不能走 `prerenderedHTML`、自定义 grammar、任意 HTML 或用户提供的 `unsafeCSS`。语法着色不执行用户源码，但这并非第三方库安全审计结论。[高亮器源码](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/highlighter/shared_highlighter.ts)、[语言加载源码](https://github.com/pierrecomputer/pierre/blob/main/packages/diffs/src/highlighter/languages/resolveLanguage.ts)

**Worker / CSP。** 建议先无 Worker 完成有上限的数据预览。实际需要时使用官方 Vite 方式：`import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'`，然后 `new Worker(WorkerUrl, { type: 'module' })`，Vite 的 `worker.format` 可能需设 `'es'`。不照搬其他平台 blob/fetch 方案。当前 PUA CSP 为 `connect-src 'none'`、`script-src 'self' 'wasm-unsafe-eval'`、`style-src 'self' 'unsafe-inline'`，没有单独 worker-src；先验证生产 Electron 本地 URL 的 Worker 启动，不为库泛化放开网络或 unsafe-eval。库内 style 元素也须在真实 CSP 下验证。Worker API 官方仍标为实验性；theme、lineDiffType、tokenizeMaxLineLength 等由共享 pool 控制，而非每个 FileDiff 独立控制。[官方 Worker 说明](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/WorkerPool/content.mdx)、[官方 Vite 示例](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/WorkerPool/constants.ts)

**SSR。** PUA 当前客户端渲染，不需要 SSR 入口。若未来做 SSR，只接收同一可信 preload 函数生成的结果且客户端参数完全一致；不接受外部 HTML。Shadow DOM/ResizeObserver 的真实浏览器行为不能由 jsdom 快照替代。[官方 SSR 说明](https://github.com/pierrecomputer/pierre/blob/main/apps/docs/app/%28diffs%29/docs/SSR/content.mdx)

## 接入验收门槛

隔离 fixture 覆盖：多文件增删、rename、删除文件、无末尾换行、中文路径、空 patch、二进制、symlink、combined conflict、截断 patch、巨长行、多 hunk 行号、恶意 HTML 字符串。浏览器验证浅深色、窄侧栏、resize/scroll、切 session 后没有旧 diff、无外网请求、真实 CSP、构建后语言 chunk；只有具备原文 loader 才验收 unchanged 展开。接入后保留 Apache-2.0 许可证与依赖归属信息。

## 本仓库接入记录

随后已安装精确版本 1.4.3，并封装 `ui/DiffView` → 懒加载 `DiffSurface`。首版未启用 Virtualizer/Worker：IPC 每批 5 文件、3 并发；大于 120,000 字符或 4,000 行改用完整返回文本的原文预览，避免无界语法 DOM。并非宣布超大仓库性能已解决。元数据-only/解析失败保留原文；combined conflict/截断由 feature 分流。

已验证解析/转义/元数据降级、并发批次、跨 scope/session 晚到结果；真实浏览器检验 unified 着色、浅深色 token、浮窗和多标签焦点与窄屏；生产构建产出本地语法 chunk，构建后的 Fake Desktop 页面使用未修改的生产 CSP 跑通且没有外部请求。该验证不是 Electron 实机安全审计或全部上述边界的穷举验收。`--diffs-bg` 必须设在 diffs-container 宿主上，wrapper 继承会被库的 :host 默认值覆盖；库会再次混合 addition/deletion override，因此使用基础语义色而非已混合的浅背景色。

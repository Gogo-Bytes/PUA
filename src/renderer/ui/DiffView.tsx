import { Component, lazy, Suspense, type ReactNode } from 'react';

export interface DiffViewProps { text: string; theme: 'light' | 'dark' }
const Surface = lazy(() => import('./DiffSurface'));
export function RawPatch({ text, note = '原始 patch · 无法完整解析或仅含文件元数据时保留原文' }: { text: string; note?: string }) {
  return <div className="ui-raw-patch"><small>{note}</small><pre>{text}</pre></div>;
}
class PatchBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <RawPatch text={this.props.text}/> : this.props.children; }
}
/** Read-only patch surface; no filesystem, IPC, HTML input or remote language loading. */
export function DiffView(props: DiffViewProps) {
  if (props.text.length > 120_000 || props.text.split('\n').length > 4000) return <RawPatch text={props.text} note="大型 patch · 原文预览（保留全部返回内容）"/>;
  return <div className="ui-diff-view" aria-label="文件差异（统一视图，删除行原行号，新增行新行号）">
    <PatchBoundary key={props.text} text={props.text}><Suspense fallback={<pre>{props.text}</pre>}><Surface {...props}/></Suspense></PatchBoundary>
  </div>;
}

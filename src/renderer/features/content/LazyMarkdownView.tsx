import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

const MarkdownView = lazy(() => import('./MarkdownView').then(module => ({ default: module.MarkdownView })));
export function LazyMarkdownView(props: ComponentProps<typeof import('./MarkdownView')['MarkdownView']>) {
  return <Suspense fallback={<div className="markdown-loading" aria-label="正在渲染内容"/>}><MarkdownView {...props}/></Suspense>;
}

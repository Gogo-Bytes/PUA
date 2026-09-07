import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import remend from 'remend';
import { Icon } from './Icon';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDone(false); setError(''); }, [text]);
  return <span className="copy-action"><button className="copy-button" aria-label={label} onClick={() => {
    setError(''); setDone(false);
    void window.desktop.writeClipboard(text).then(() => setDone(true)).catch(error => setError(`复制失败：${String(error)}`));
  }}><Icon name={done ? 'check' : 'copy'} />{done ? '已复制' : '复制'}</button>{error && <span role="alert" className="form-error">{error}</span>}</span>;
}
function SafeLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const [error, setError] = useState('');
  return <><a href={href} onClick={event => { event.preventDefault(); if (href) void window.desktop.openExternal(href).catch(error => setError(`打开链接失败：${String(error)}`)); }}>{children}</a>{error && <span role="alert" className="form-error">{error}</span>}</>;
}
export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const source = streaming ? remend(text, { images: false, links: true }) : text;
  return <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
    img: ({ alt }) => <span className="remote-image">[远程图片未自动加载{alt ? `：${alt}` : ''}]</span>,
    pre: ({ children }) => <CodeBlock text={nodeText(children)}>{children}</CodeBlock>,
  }}>{source}</Markdown>;
}
function CodeBlock({ text, children }: { text: string; children: React.ReactNode }) {
  const lines = text.replace(/\n$/, '').split('\n');
  return <div className="code-block"><div className="code-toolbar"><span><Icon name="code" />代码 · {lines.length} 行</span><CopyButton text={text} label="复制代码" /></div><div className="code-scroll"><div className="line-gutter" aria-hidden="true">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre>{children}</pre></div></div>;
}
export function SourceView({ text, label = '只读源码' }: { text: string; label?: string }) {
  return <div className="source-view" aria-label={label}>{text.split('\n').map((line, index) => <div className="source-line" key={index}><span aria-hidden="true">{index + 1}</span><code>{line || ' '}</code></div>)}</div>;
}
function nodeText(node: unknown): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(nodeText).join(''); if (node && typeof node === 'object' && 'props' in node) return nodeText((node as { props?: { children?: unknown } }).props?.children); return ''; }

import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLanguage from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import remend from 'remend';
import { desktopClient } from '../../app/desktop-client';
import { Icon } from '../../ui';
import { CopyButton } from './CopyButton';

const languages = { bash, css, diff, javascript, json, markdown: markdownLanguage, python, sql, typescript, xml };
function SafeLink({ href, children }: { href?: string; children: React.ReactNode }) {
  const [error, setError] = useState('');
  return <><a href={href} onClick={event => { event.preventDefault(); if (href) void desktopClient.openExternal(href).catch(error => setError(`打开链接失败：${String(error)}`)); }}>{children}</a>{error && <span role="alert" className="form-error">{error}</span>}</>;
}
export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const source = streaming ? remend(text, { images: false, links: true }) : text;
  return <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { languages }]]} components={{
    a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
    img: ({ alt }) => <span className="remote-image">[远程图片未自动加载{alt ? `：${alt}` : ''}]</span>,
    pre: ({ children }) => <CodeBlock text={nodeText(children)}>{children}</CodeBlock>,
  }}>{source}</Markdown>;
}
function CodeBlock({ text, children }: { text: string; children: React.ReactNode }) {
  const lines = text.replace(/\n$/, '').split('\n');
  return <div className="code-block"><div className="code-toolbar"><span><Icon name="code" />代码 · {lines.length} 行</span><CopyButton text={text} label="复制代码" /></div><div className="code-scroll"><div className="line-gutter" aria-hidden="true">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre>{children}</pre></div></div>;
}
function nodeText(node: unknown): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(nodeText).join(''); if (node && typeof node === 'object' && 'props' in node) return nodeText((node as { props?: { children?: unknown } }).props?.children); return ''; }

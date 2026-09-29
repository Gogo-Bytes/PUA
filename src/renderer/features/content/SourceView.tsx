export function SourceView({ text, label = '只读源码' }: { text: string; label?: string }) {
  return <div className="source-view" aria-label={label}>{text.split('\n').map((line, index) => <div className="source-line" key={index}><span aria-hidden="true">{index + 1}</span><code>{line || ' '}</code></div>)}</div>;
}

import { Button, Tooltip } from './primitives';
export type BreadcrumbItem = { id: string; label: string } & ({ href?: string; onSelect?: never } | { href?: never; onSelect(): void });
export interface BreadcrumbsProps { items: readonly BreadcrumbItem[]; label?: string }
/** Ordinary navigation only: no executable schemes, protocol-relative URLs, control characters or backslashes. */
function safeHref(href: string): string | undefined {
  if (/[\u0000-\u0020\u007f\\]/.test(href) || href.startsWith('//')) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)) return undefined;
  return href;
}
function BreadcrumbLabel({ item, current = false, expanded = false }: { item: BreadcrumbItem; current?: boolean; expanded?: boolean }) {
  const href = item.href ? safeHref(item.href) : undefined;
  const content = current ? <span tabIndex={0} aria-current="page" className="ui-breadcrumb-label">{item.label}</span>
    : item.onSelect ? <Button className="ui-breadcrumb-label" variant="ghost" onClick={item.onSelect}>{item.label}</Button>
    : href ? <a className="ui-breadcrumb-label" href={href}>{item.label}</a>
    : <span tabIndex={expanded ? undefined : 0} className="ui-breadcrumb-label">{item.label}</span>;
  return expanded ? content : <Tooltip content={item.label}>{content}</Tooltip>;
}
/** Single-line hierarchy; middle levels remain operable in a native disclosure, full labels on focus. */
export function Breadcrumbs({ items, label = 'Breadcrumbs' }: BreadcrumbsProps) {
  const collapsed = items.length > 3;
  const visible = collapsed ? [items[0], items[items.length - 1]] : items;
  return <nav className="ui-breadcrumbs" aria-label={label}><ol>{visible.map((item, index) => {
    const current = index === visible.length - 1;
    return <li key={item.id} className={current ? 'ui-breadcrumb-current' : undefined}>
      {index > 0 && <span aria-hidden="true" className="ui-breadcrumb-separator">/</span>}
      {collapsed && index === 1 && <><details className="ui-breadcrumb-overflow" onKeyDown={event => {
        if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
      }}><summary aria-label={`${label}: ${items.length - 2} hidden levels`}>…</summary><ol>{items.slice(1, -1).map(parent => <li key={parent.id}><BreadcrumbLabel item={parent} expanded/></li>)}</ol></details><span aria-hidden="true" className="ui-breadcrumb-separator">/</span></>}
      <BreadcrumbLabel item={item} current={current}/>
    </li>;
  })}</ol></nav>;
}

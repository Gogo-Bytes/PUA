import { useState, type ComponentProps } from 'react';
import { vi } from 'vitest';

// Transport/draft tests don't run Floating UI's geometry loop in jsdom.
// Only Composer's attachment menu and suggestion positioning are replaced; behavior is
// covered by composer-controls-check.mjs and the Fake Desktop browser preview.
vi.mock('../src/renderer/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/renderer/ui')>();
  function DropdownMenu(props: ComponentProps<typeof actual.DropdownMenu>) {
    const [open, setOpen] = useState(false);
    if (!props.iconOnly) return <actual.DropdownMenu {...props}/>;
    return <><button type="button" aria-label={props.label} disabled={props.disabled} aria-expanded={open} onClick={() => setOpen(!open)}>{props.label}</button>
      {open && <div role="menu">{props.items.map(item => <button type="button" role="menuitem" key={item.value} disabled={item.disabled} onClick={() => { setOpen(false); props.onAction(item.value); }}>{item.label}</button>)}</div>}
    </>;
  }
  function SuggestionList({ items, label, listRef, anchor, onSelect, onDismiss }: ComponentProps<typeof actual.SuggestionList>) {
    return <div onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); anchor.current?.focus(); } }}>
      <actual.SuggestionOptions items={items} label={label} listRef={listRef} onSelect={onSelect}/>
    </div>;
  }
  return { ...actual, DropdownMenu, SuggestionList };
});

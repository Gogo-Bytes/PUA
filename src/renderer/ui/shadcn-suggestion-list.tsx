import { useState, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Toolbar } from '@base-ui/react/toolbar';
import { useOverlayContainer } from './theme';
import { cn, itemClass, popupClass } from './shadcn-utils';

export interface SuggestionItem { id: string; label: string; description?: string }
/** Non-modal suggestions: typing retains focus; Base UI handles positioning and list navigation. */
export function SuggestionList({ items, label, anchor, listRef, onSelect, onDismiss }: {
  items: readonly SuggestionItem[]; label: string; anchor: RefObject<HTMLElement | null>;
  listRef: RefObject<HTMLDivElement | null>; onSelect(id: string): void; onDismiss(): void;
}) {
  const container = useOverlayContainer();
  return <Popover.Root open={items.length > 0} onOpenChange={(open, event) => { if (!open) { onDismiss(); if (event.reason === 'escape-key') anchor.current?.focus(); } }}>
    <Popover.Portal container={container} className="shadcn-scope"><Popover.Positioner anchor={anchor} side="top" align="start" sideOffset={8} className="tw:z-50">
      <Popover.Popup initialFocus={false} finalFocus={false} role="presentation" className={cn(popupClass, 'tw:w-80')}>
        <SuggestionOptions items={items} label={label} listRef={listRef} onSelect={onSelect}/>
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}

/** Shared inline list for command dialogs and anchored editor suggestions. */
export function SuggestionOptions({ items, label, listRef, onSelect }: {
  items: readonly SuggestionItem[]; label: string; listRef: RefObject<HTMLDivElement | null>; onSelect(id: string): void;
}) {
  const [focused, setFocused] = useState<string>();
  return <Toolbar.Root ref={listRef} orientation="vertical" role="listbox" aria-label={label} onKeyDown={event => {
    // Toolbar supplies roving arrows, but its public API omits Home/End.
    if (event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const options = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]');
    options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
  }}>
          {items.map(item => <Toolbar.Button key={item.id} role="option" aria-selected={focused === item.id}
            onFocus={() => setFocused(item.id)} className={cn(itemClass, 'tw:w-full tw:border-0 tw:bg-transparent tw:text-left tw:text-foreground tw:focus:bg-accent tw:hover:bg-accent')}
            onClick={() => onSelect(item.id)}><span className="tw:min-w-0 tw:break-all"><span>{item.label}</span>{item.description && <small className="tw:block tw:text-muted-foreground">{item.description}</small>}</span></Toolbar.Button>)}
        </Toolbar.Root>;
}

import { useRef, type RefObject } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Icon, type IconName } from './Icon';
import { IconButton } from './primitives';

/** Closable tabs: close controls are siblings, never buttons nested inside tabs. */
export function PanelTabs({ items, value, onChange, onClose, emptyFocusRef, idPrefix }: {
  items: readonly { id: string; label: string; icon: IconName }[];
  value: string | null; onChange(id: string): void; onClose(id: string): void;
  emptyFocusRef?: RefObject<HTMLButtonElement | null>;
  idPrefix: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  return <Tabs.Root ref={root} value={value} onValueChange={value => { if (value !== null) onChange(String(value)); }}>
    <Tabs.List className="ui-panel-tabs" aria-label="右侧标签页">
      {items.map(item => <div className="ui-panel-tab" data-active={value === item.id || undefined} key={item.id}>
        <Tabs.Tab id={`${idPrefix}-tab-${item.id}`} aria-controls={`${idPrefix}-panel-${item.id}`} value={item.id} className="ui-panel-tab-select"><Icon name={item.icon}/><span>{item.label}</span></Tabs.Tab>
        <IconButton icon="close" label={`关闭 ${item.label} 标签页`} variant="ghost" onClick={() => {
          onClose(item.id);
          requestAnimationFrame(() => {
            const selected = root.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
            (selected ?? emptyFocusRef?.current)?.focus();
          });
        }}/>
      </div>)}
    </Tabs.List>
  </Tabs.Root>;
}

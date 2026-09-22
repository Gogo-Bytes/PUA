import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { Icon } from './Icon';
import { useOverlayContainer } from './theme';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from './shadcn-select';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem } from './shadcn-menu';

export type Choice = { value: string; label: string; disabled?: boolean };
export type SelectProps = {
  label: string;
  options: Choice[];
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  onOpenChange?(open: boolean): void;
};

/** Base UI owns navigation, dismissal, positioning and focus restoration. */
export function Select({ label, options, value, onChange, disabled, onOpenChange }: SelectProps) {
  const container = useOverlayContainer();
  return <SelectRoot modal={false} items={options} value={value} onValueChange={next => { if (next !== null) onChange(next); }}
    disabled={disabled || !options.some(option => !option.disabled)} onOpenChange={onOpenChange}>
    <SelectTrigger aria-label={label}><SelectValue placeholder={label}/></SelectTrigger>
    <SelectContent container={container} aria-label={label}>
      {options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
    </SelectContent>
  </SelectRoot>;
}

export function DropdownMenu({ label, items, onAction, icon, iconOnly = false, disabled = false }: {
  label: string; items: Choice[]; onAction(value: string): void; icon?: Parameters<typeof Icon>[0]['name']; iconOnly?: boolean; disabled?: boolean;
}) {
  const container = useOverlayContainer();
  return <div className="ui-popup-anchor"><MenuRoot>
    <MenuTrigger className={`ui-button ui-button-ghost ${iconOnly ? 'ui-icon-button' : ''}`} aria-label={label} disabled={disabled || !items.some(item => !item.disabled)}>{!iconOnly && label}<Icon name={icon ?? 'down'}/></MenuTrigger>
    <MenuContent container={container} aria-label={label}>
      {items.map(item => <MenuItem key={item.value} disabled={item.disabled} onClick={() => onAction(item.value)}>{item.label}</MenuItem>)}
    </MenuContent>
  </MenuRoot></div>;
}

export function Tabs({ label, items, value, onChange }: {
  label: string; items: Choice[]; value: string; onChange(value: string): void;
}) {
  return <TabsPrimitive.Root value={value} onValueChange={next => onChange(String(next))}>
    <TabsPrimitive.List className="ui-tabs" aria-label={label} activateOnFocus>
      {items.map(item => <TabsPrimitive.Tab key={item.value} value={item.value} disabled={item.disabled}
        className="ui-button ui-button-ghost">{item.label}</TabsPrimitive.Tab>)}
    </TabsPrimitive.List>
  </TabsPrimitive.Root>;
}

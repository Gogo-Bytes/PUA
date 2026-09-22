import { useOverlayContainer } from './theme';
import type { Choice, SelectProps } from './ChoiceControls';
import { ComboboxRoot, ComboboxTrigger, ComboboxValue, ComboboxContent, ComboboxInput, ComboboxEmpty, ComboboxList, ComboboxItem } from './shadcn-combobox';

export function SearchSelect({ label, value, options, onChange, disabled, onOpenChange }: SelectProps) {
  const container = useOverlayContainer();
  return <ComboboxRoot items={options} value={options.find(item => item.value === value) ?? null}
    itemToStringLabel={(item: Choice) => item.label} isItemEqualToValue={(a, b) => a.value === b.value}
    onValueChange={item => { if (item) onChange(item.value); }} onOpenChange={onOpenChange} disabled={disabled}>
    <ComboboxTrigger aria-label={label}><ComboboxValue placeholder={label}/></ComboboxTrigger>
    <ComboboxContent container={container}><ComboboxInput aria-label={`搜索${label}`} placeholder={`搜索${label}…`}/>
      <ComboboxEmpty className="tw:p-2 tw:text-muted-foreground">没有匹配的选项</ComboboxEmpty>
      <ComboboxList>{(item: Choice) => <ComboboxItem key={item.value} value={item} disabled={item.disabled}>{item.label}</ComboboxItem>}</ComboboxList>
    </ComboboxContent>
  </ComboboxRoot>;
}

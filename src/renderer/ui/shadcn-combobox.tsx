// Adapted from shadcn/ui base-nova Combobox (MIT); see SHADCN-LICENSE.txt.
import { Combobox as Primitive } from '@base-ui/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import { cn, itemClass, popupClass, triggerClass } from './shadcn-utils';

export const ComboboxRoot = Primitive.Root;
export const ComboboxValue = Primitive.Value;
export const ComboboxList = Primitive.List;
export const ComboboxEmpty = Primitive.Empty;
export function ComboboxTrigger({ children, className, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger {...props} className={cn(triggerClass, className)}>{children}<ChevronDown size={14}/></Primitive.Trigger>;
}
export function ComboboxContent({ container, className, ...props }: Primitive.Popup.Props & { container: Primitive.Portal.Props['container'] }) {
  return <Primitive.Portal container={container} className="shadcn-scope"><Primitive.Positioner side="top" align="start" sideOffset={8} className="tw:z-50"><Primitive.Popup {...props} className={cn(popupClass, 'tw:w-72', className)}/></Primitive.Positioner></Primitive.Portal>;
}
export function ComboboxInput({ className, ...props }: Primitive.Input.Props) {
  return <Primitive.Input {...props} className={cn('tw:mb-1 tw:h-8 tw:w-full tw:rounded-md tw:bg-muted tw:px-2 tw:outline-none tw:focus-visible:outline-2 tw:focus-visible:outline-ring tw:-outline-offset-2', className)}/>;
}
export function ComboboxItem({ children, className, ...props }: Primitive.Item.Props) {
  return <Primitive.Item {...props} className={cn(itemClass, className)}>{children}<Primitive.ItemIndicator className="tw:absolute tw:right-2 tw:flex"><Check size={14}/></Primitive.ItemIndicator></Primitive.Item>;
}

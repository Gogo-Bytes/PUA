// Adapted from shadcn/ui base-nova Select (MIT); see SHADCN-LICENSE.txt.
import { Select as Primitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn, itemClass, popupClass, triggerClass } from './shadcn-utils';

export const SelectRoot = Primitive.Root;
export const SelectValue = Primitive.Value;
export function SelectTrigger({ className, children, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger {...props} className={cn(triggerClass, className)}>{children}<Primitive.Icon><ChevronDown size={14}/></Primitive.Icon></Primitive.Trigger>;
}
export function SelectContent({ container, children, className, ...props }: Primitive.Popup.Props & { container: Primitive.Portal.Props['container'] }) {
  return <Primitive.Portal container={container} className="shadcn-scope"><Primitive.Positioner side="top" align="start" sideOffset={8} alignItemWithTrigger={false} className="tw:z-50"><Primitive.Popup {...props} className={cn(popupClass, 'tw:min-w-40', className)}><Primitive.List>{children}</Primitive.List></Primitive.Popup></Primitive.Positioner></Primitive.Portal>;
}
export function SelectItem({ children, className, ...props }: Primitive.Item.Props) {
  return <Primitive.Item {...props} className={cn(itemClass, className)}><Primitive.ItemText>{children}</Primitive.ItemText><Primitive.ItemIndicator className="tw:absolute tw:right-2 tw:flex"><Check size={14}/></Primitive.ItemIndicator></Primitive.Item>;
}

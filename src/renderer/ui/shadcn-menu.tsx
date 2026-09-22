// Adapted from shadcn/ui base-nova DropdownMenu (MIT); see SHADCN-LICENSE.txt.
import { Menu as Primitive } from '@base-ui/react/menu';
import { cn, itemClass, popupClass, triggerClass } from './shadcn-utils';

export const MenuRoot = Primitive.Root;
export function MenuTrigger({ className, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger {...props} className={cn(triggerClass, className)}/>;
}
export function MenuContent({ container, className, ...props }: Primitive.Popup.Props & { container: Primitive.Portal.Props['container'] }) {
  return <Primitive.Portal container={container} className="shadcn-scope"><Primitive.Positioner side="top" align="start" sideOffset={8} className="tw:z-50"><Primitive.Popup {...props} className={cn(popupClass, 'tw:min-w-44', className)}/></Primitive.Positioner></Primitive.Portal>;
}
export function MenuItem({ className, ...props }: Primitive.Item.Props) {
  return <Primitive.Item {...props} className={cn(itemClass, className)}/>;
}

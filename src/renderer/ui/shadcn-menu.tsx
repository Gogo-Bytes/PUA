// Adapted from shadcn/ui base-nova DropdownMenu (MIT); see SHADCN-LICENSE.txt.
import { Menu as Primitive } from '@base-ui/react/menu';
import { useRef } from 'react';
import { cn, itemClass, popupClass, triggerClass } from './shadcn-utils';
import { gsap, useGSAP } from './motion';
import { useMotionScale } from './theme';

export const MenuRoot = Primitive.Root;
export const MenuRadioGroup = Primitive.RadioGroup;
export function MenuRadioItem({ className, ...props }: Primitive.RadioItem.Props) {
  return <Primitive.RadioItem {...props} className={cn(itemClass, 'tw:data-checked:bg-accent', className)}/>;
}
export function MenuTrigger({ className, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger {...props} className={cn(triggerClass, className)}/>;
}
export function MenuContent({ container, className, ...props }: Primitive.Popup.Props & { container: Primitive.Portal.Props['container'] }) {
  return <Primitive.Portal container={container} className="shadcn-scope"><Primitive.Positioner side="top" align="start" sideOffset={8} className="tw:z-50 ui-menu-positioner"><AnimatedMenuPopup {...props} className={cn('ui-menu-content', popupClass, 'tw:min-w-44', className)}/></Primitive.Positioner></Primitive.Portal>;
}

function AnimatedMenuPopup(props: Primitive.Popup.Props) {
  const root = useRef<HTMLDivElement>(null);
  const scale = useMotionScale();
  useGSAP(() => {
    if (!root.current || !scale) return;
    gsap.fromTo(root.current, { y: 4, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.16 * scale, ease: 'power2.out', overwrite: 'auto' });
  }, { scope: root, dependencies: [scale] });
  return <Primitive.Popup {...props} ref={root}/>;
}
export function MenuItem({ className, ...props }: Primitive.Item.Props) {
  return <Primitive.Item {...props} className={cn(itemClass, className)}/>;
}

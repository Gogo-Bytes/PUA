import type { ReactNode } from 'react';
import { Popover as Primitive } from '@base-ui/react/popover';
import { Icon, type IconName } from './Icon';
import { useOverlayContainer } from './theme';

/** Anchored, non-modal surface. Base UI owns dismissal, positioning and focus return. */
export function Popover({ label, icon, open, onOpenChange, children, className = '' }: {
  label: string; icon: IconName; open: boolean; onOpenChange(open: boolean): void;
  children: ReactNode; className?: string;
}) {
  const container = useOverlayContainer();
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>
    <Primitive.Trigger className="ui-button ui-button-ghost ui-icon-button" aria-label={label}>
      <Icon name={icon}/>
    </Primitive.Trigger>
    <Primitive.Portal container={container}>
      <Primitive.Positioner side="bottom" align="end" sideOffset={12} className="ui-popover-positioner">
        <Primitive.Popup className={`ui-popover ${className}`} aria-label={label}>
          {children}
        </Primitive.Popup>
      </Primitive.Positioner>
    </Primitive.Portal>
  </Primitive.Root>;
}

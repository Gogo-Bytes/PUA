// Adapted from shadcn/ui Dialog composition (MIT); see SHADCN-LICENSE.txt.
import { useRef, type ReactNode, type RefObject } from 'react';
import { Dialog as Primitive } from '@base-ui/react/dialog';
import { IconButton } from './primitives';
import { OverlayContainerContext, useOverlayContainer } from './theme';

/** Controlled dialog: caller retains submission state; Base UI owns focus and dismissal. */
export function Dialog({ open, title, onClose, children, initialFocusRef, closeLabel = 'Close dialog', closeDisabled = false, closeOnBackdrop = true }: {
  open: boolean; title: string; onClose(): void; children: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>; closeLabel?: string; closeDisabled?: boolean; closeOnBackdrop?: boolean;
}) {
  const container = useOverlayContainer();
  const popup = useRef<HTMLDivElement>(null);
  return <Primitive.Root open={open} disablePointerDismissal={!closeOnBackdrop || closeDisabled}
    onOpenChange={(next, event) => { if (!next && !closeDisabled) onClose(); else if (!next) event.cancel(); }}>
    <Primitive.Portal container={container} className="shadcn-scope">
      <Primitive.Backdrop className="ui-dialog-backdrop"/>
      <Primitive.Popup ref={popup} className="ui-dialog" initialFocus={initialFocusRef}>
        <div className="ui-dialog-header"><Primitive.Title>{title}</Primitive.Title>
          <Primitive.Close render={<IconButton label={closeLabel} icon="close" variant="ghost" disabled={closeDisabled}/>}/>
        </div>
        <OverlayContainerContext.Provider value={popup}>{children}</OverlayContainerContext.Provider>
      </Primitive.Popup>
    </Primitive.Portal>
  </Primitive.Root>;
}

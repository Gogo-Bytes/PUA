import { Menu } from '@base-ui/react/menu';
import { Check, ChevronRight, Ellipsis } from 'lucide-react';
import { useOverlayContainer } from '../provider';
import { actionKey, EnsureActionScope, useActions } from './actions';
import { Feedback, ItemIcon } from './shared';
import type { SidebarMenuItem } from './types';

export interface ProjectMenuProps {
  projectId: string;
  label: string;
  items: readonly SidebarMenuItem[];
  disabled?: boolean;
  onAction: (actionId: string) => void | Promise<void>;
}

export function ProjectMenu({ projectId, ...props }: ProjectMenuProps) {
  return <RowMenu {...props} target={actionKey('project', projectId)} />;
}
export interface SessionMenuProps extends Omit<ProjectMenuProps, 'projectId'> { sessionId: string }
export function SessionMenu({ sessionId, ...props }: SessionMenuProps) {
  return <RowMenu {...props} target={actionKey('session', sessionId)} />;
}
type RowMenuProps = Omit<ProjectMenuProps, 'projectId'> & { target: string; feedback?: boolean };
/** Internal composition seam: row-level feedback replaces standalone feedback. */
export function RowMenu(props: RowMenuProps) {
  return <EnsureActionScope target={props.target}><RowMenuContent {...props} /></EnsureActionScope>;
}
function RowMenuContent({ target, label, items, disabled, feedback = true, onAction }: RowMenuProps) {
  const actions = useActions();
  const container = useOverlayContainer();
  const pending = actions.pending(target);
  function invoke(id: string, title: string) { void actions.run(target, title, () => onAction(id)); }
  return <>
    <Menu.Root>
      <Menu.Trigger className="pua-icon-button pua-menu-trigger" aria-label={label} title={label} disabled={disabled}
        aria-busy={pending || undefined}>
        <Ellipsis size={17} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} className="pua-menu-positioner">
          <Menu.Popup className="pua-menu-popup" aria-label={label}>
            <MenuItems items={items} disabled={!!(disabled || pending)} onAction={invoke} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    {feedback && <Feedback target={target} />}
  </>;
}
function MenuItems({ items, disabled, onAction }: { items: readonly SidebarMenuItem[]; disabled: boolean; onAction(id: string, label: string): void }) {
  const container = useOverlayContainer();
  return items.map(item => {
    if (item.type === 'separator') return <Menu.Separator key={item.id} className="pua-menu-separator" />;
    const blocked = disabled || !!item.disabled || !!item.disabledReason;
    const name = `${item.label}${item.disabledReason ? ` · ${item.disabledReason}` : ''}`;
    const content = <><ItemIcon name={item.icon} /><span className="pua-menu-copy"><span>{item.label}</span>{item.disabledReason && <small>{item.disabledReason}</small>}</span></>;
    if (item.type === 'submenu') return <Menu.SubmenuRoot key={item.id}>
      <Menu.SubmenuTrigger className="pua-menu-item" disabled={blocked} aria-label={name} label={item.label}>
        {content}<ChevronRight size={14} className="pua-menu-trailing" aria-hidden="true" />
      </Menu.SubmenuTrigger>
      <Menu.Portal container={container}>
        <Menu.Positioner side="right" align="start" sideOffset={5} className="pua-menu-positioner">
          <Menu.Popup className="pua-menu-popup" aria-label={item.label}>
            <MenuItems items={item.items} disabled={blocked} onAction={onAction} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>;
    if (item.checked !== undefined) return <Menu.CheckboxItem key={item.id} className="pua-menu-item" checked={item.checked} closeOnClick data-danger={item.danger || undefined}
      disabled={blocked} aria-label={name} label={item.label} onCheckedChange={() => { if (!blocked) onAction(item.id, item.label); }}>
      {content}{item.checked && <Check size={14} className="pua-menu-trailing" aria-hidden="true" />}
    </Menu.CheckboxItem>;
    return <Menu.Item key={item.id} className="pua-menu-item" data-danger={item.danger || undefined} disabled={blocked}
      aria-label={name} label={item.label}
      onClick={() => { if (!blocked) onAction(item.id, item.label); }}>
      {content}
    </Menu.Item>;
  });
}

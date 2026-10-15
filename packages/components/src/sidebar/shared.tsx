import { Archive, Check, Folder, FolderOpen, Globe, SquarePen, Pin, Plus, Terminal, Trash2, FolderInput, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import type { MenuIcon } from './types';
import { useActions } from './actions';

const icons: Record<MenuIcon, LucideIcon> = { pin: Pin, edit: SquarePen, folder: Folder, reveal: FolderInput, terminal: Terminal, read: Check, archive: Archive, trash: Trash2, plus: Plus, connection: Globe };
export function ItemIcon({ name }: { name?: MenuIcon }) {
  const Component = name ? icons[name] : undefined;
  return Component ? <Component size={16} aria-hidden="true" /> : <span className="pua-menu-icon-space" />;
}
export function ActionButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" {...props} aria-label={label} title={props.title ?? label} className={`pua-icon-button ${className}`}>{children}</button>;
}
export function FolderDisclosure({ expanded }: { expanded: boolean }) {
  const Icon = expanded ? FolderOpen : Folder;
  return <Icon size={16} className="pua-folder-icon" aria-hidden="true" />;
}
export function Feedback({ target }: { target: string }) {
  const actions = useActions();
  return <>{actions.label(target) && <span className="pua-feedback" role="status">{actions.label(target)}…</span>}
    {actions.error(target) && <span className="pua-error" role="alert">{actions.error(target)}</span>}</>;
}

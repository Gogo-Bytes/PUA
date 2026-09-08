import type { ComponentProps } from 'react';
import {
  Pi, Folder, Plus, X, Search, Settings, MessageSquare,
  ChevronDown, ChevronRight, PanelLeft, ArrowUp, Square, Check,
  File, CodeXml, Copy, Link, RotateCw, Clock, LoaderCircle,
  Pause, Info, CircleAlert, CircleX, CircleCheck, Terminal,
} from 'lucide-react';

// One icon family for the preview library; production keeps its existing seam.
const icons = {
  pi: Pi, folder: Folder, plus: Plus, close: X, search: Search,
  settings: Settings, chat: MessageSquare, down: ChevronDown,
  chevron: ChevronRight, panel: PanelLeft, up: ArrowUp, stop: Square,
  check: Check, file: File, code: CodeXml, copy: Copy, link: Link,
  refresh: RotateCw, clock: Clock, running: LoaderCircle, pause: Pause,
  info: Info, warning: CircleAlert, error: CircleX, success: CircleCheck,
  terminal: Terminal,
} as const;

export type IconName = keyof typeof icons;
export function Icon({ name, className = '', ...props }: Omit<ComponentProps<'svg'>, 'children'> & { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph {...props} className={`icon ${className}`} size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/>;
}

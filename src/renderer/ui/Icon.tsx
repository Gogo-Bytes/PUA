import type { ComponentProps } from 'react';
import {
  Pi, Folder, FolderOpen, Plus, X, Search, Settings, MessageSquare,
  ChevronDown, ChevronRight, PanelLeft, PanelRight, ArrowUp, Square, Check,
  File, CodeXml, Copy, Link, RotateCw, Clock, LoaderCircle,
  Pause, Info, CircleAlert, CircleX, CircleCheck, Terminal, PencilLine, GitFork, ArrowLeft, ArrowRight,
  MoreHorizontal, Pin, Archive, GitBranch, FileDiff, Globe, ListFilter, Laptop, Users, Maximize2, Minimize2,
} from 'lucide-react';

// One icon family for the preview library; production keeps its existing seam.
const icons = {
  pi: Pi, folder: Folder, folderOpen: FolderOpen, plus: Plus, close: X, search: Search,
  settings: Settings, chat: MessageSquare, down: ChevronDown,
  chevron: ChevronRight, panel: PanelLeft, panelRight: PanelRight, up: ArrowUp, stop: Square,
  check: Check, file: File, code: CodeXml, copy: Copy, link: Link,
  refresh: RotateCw, clock: Clock, running: LoaderCircle, pause: Pause,
  info: Info, warning: CircleAlert, error: CircleX, success: CircleCheck,
  terminal: Terminal, edit: PencilLine, fork: GitFork, back: ArrowLeft, forward: ArrowRight,
  more: MoreHorizontal, pin: Pin, archive: Archive, branch: GitBranch, review: FileDiff,
  browser: Globe, environment: ListFilter, local: Laptop, agents: Users, maximize: Maximize2, minimize: Minimize2,
} as const;

export type IconName = keyof typeof icons;
export function Icon({ name, className = '', ...props }: Omit<ComponentProps<'svg'>, 'children'> & { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph {...props} className={`icon ${className}`} size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/>;
}

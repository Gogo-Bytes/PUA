import { useRef } from 'react';
import { Button, Dialog } from '../../ui';
import type { useCommandPalette } from './useCommandPalette';

export function CommandPalette({ palette, onInsert }: { palette: ReturnType<typeof useCommandPalette>; onInsert(text: string): void }) {
  const initialFocus = useRef<HTMLInputElement>(null);
  if (!palette.isOpen || !palette.kind) return null;
  return <Dialog initialFocusRef={initialFocus} open title={palette.kind === 'chat' ? 'Pi 命令' : '终端命令'} closeLabel="关闭对话框" closeOnBackdrop={false} onClose={palette.close}>
    <input ref={initialFocus} className="ui-input full-input" aria-label="搜索命令" placeholder="搜索扩展、提示模板或技能（输入 @ 可在对话框中直接筛选）…" value={palette.query} onChange={event => palette.setQuery(event.target.value)} />
    <p className="muted">{palette.kind === 'chat' ? '仅显示 Pi RPC 可调用的扩展命令、提示模板和技能；设置、登录与历史选择请使用兼容终端。' : '选择后只插入到 Pi TUI，不自动执行。'}</p>
    <div className="command-list" onKeyDown={event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(event.target as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      {!palette.commands.length && <p className="muted">当前 Pi 没有提供可调用命令。登录与设置请使用兼容终端。</p>}
      {palette.commands.filter(command => `${command.label}${command.name}${command.description || ''}`.toLowerCase().includes(palette.query.toLowerCase())).map(command => <Button key={command.name} onClick={() => onInsert(`/${command.name}`)}><div>{command.label}<small>{command.description || command.source}</small></div><code>/{command.name}</code></Button>)}
    </div>
  </Dialog>;
}

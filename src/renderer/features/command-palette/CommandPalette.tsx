import { useRef } from 'react';
import { Button, Dialog, Input, SuggestionOptions } from '../../ui';
import type { useCommandPalette } from './useCommandPalette';

export function CommandPalette({ palette, onInsert, onOpenHistorySearch }: { palette: ReturnType<typeof useCommandPalette>; onInsert(text: string): void; onOpenHistorySearch?(): void }) {
  const initialFocus = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  if (!palette.isOpen || !palette.kind) return null;
  const commands = palette.commands.filter(command => `${command.label}${command.name}${command.description || ''}`.toLowerCase().includes(palette.query.toLowerCase()));
  return <Dialog initialFocusRef={initialFocus} open title={palette.kind === 'chat' ? 'Pi 命令' : '终端命令'} closeLabel="关闭对话框" closeOnBackdrop={false} onClose={palette.close}>
    <Input ref={initialFocus} className="full-input" aria-label="搜索命令" placeholder="搜索扩展、提示模板或技能…" value={palette.query} onChange={event => palette.setQuery(event.target.value)} onKeyDown={event => {
      if (!event.nativeEvent.isComposing && event.keyCode !== 229 && event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector<HTMLButtonElement>('[role=option]')?.focus(); }
    }}/>
    <p className="muted">{palette.kind === 'chat' ? '仅显示 Pi RPC 可调用的扩展命令、提示模板和技能；设置与登录请使用兼容终端。' : '选择后只插入到 Pi TUI，不自动执行。'}</p>
    {onOpenHistorySearch && <Button onClick={onOpenHistorySearch}>搜索全部历史</Button>}
    <div className="command-list">
      {!commands.length && <p className="muted">{palette.commands.length ? '没有匹配的命令。' : '当前 Pi 没有提供可调用命令。登录与设置请使用兼容终端。'}</p>}
      <SuggestionOptions listRef={list} label="命令" items={commands.map(command => ({ id: command.name, label: `${command.label} /${command.name}`, description: command.description || command.source }))} onSelect={name => onInsert(`/${name}`)}/>
    </div>
  </Dialog>;
}

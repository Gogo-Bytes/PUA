import { useCallback, useState } from 'react';
import type { ChatCommand, SessionKind } from '../../../shared/ipc/conversation';

const terminalCommands = [
  { name: 'model', label: '选择模型', description: '使用 Pi 原生模型选择器' }, { name: 'thinking', label: '思考强度', description: '选择推理等级' },
  { name: 'resume', label: '恢复历史', description: '打开 Pi 原生会话选择器' }, { name: 'tree', label: '会话分支', description: '查看会话树' },
  { name: 'settings', label: 'Pi 设置', description: '打开原生设置' }, { name: 'login', label: '登录提供商', description: '由 Pi 处理凭据' },
  { name: 'reload', label: '重新加载资源', description: '重新加载扩展和技能' }, { name: 'compact', label: '压缩上下文', description: '执行上下文压缩' },
  { name: 'hotkeys', label: '所有快捷键', description: '以当前 Pi 配置为准' },
];
const piConversationCommands: ChatCommand[] = [
  { name: 'model', description: '打开 Pi 原生模型选择器', source: 'prompt' },
  { name: 'thinking', description: '打开 Pi 原生思考级别选择器', source: 'prompt' },
  { name: 'compact', description: '请求 Pi 压缩当前上下文', source: 'prompt' },
  { name: 'tree', description: '查看当前 Pi 会话分支', source: 'prompt' },
];

// Mount at the App lifetime: hiding the Modal or changing selection must not reset query/open.
export function useCommandPalette(active: { id: string; kind: SessionKind } | undefined) {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [chatCommands, setChatCommands] = useState<Record<string, ChatCommand[]>>({});
  const toggle = useCallback(() => setOpen(value => !value), []);
  const close = useCallback(() => setOpen(false), []);
  const openFromSidebar = useCallback(() => { setOpen(true); setQuery(''); }, []);
  // Call only after the caller's synchronous insertion returns (never in finally).
  const dismissAfterInsert = useCallback(() => { setOpen(false); setQuery(''); }, []);
  const onCommands = useCallback((id: string, commands: ChatCommand[]) => {
    setChatCommands(current => current[id] === commands ? current : { ...current, [id]: commands });
  }, []);
  const commands = active?.kind === 'chat'
    ? [...piConversationCommands, ...(chatCommands[active.id] ?? [])].filter((command, index, all) => all.findIndex(item => item.name === command.name) === index).map(command => ({ ...command, label: `/${command.name}` }))
    : terminalCommands.map(command => ({ ...command, source: 'terminal' as const }));

  return { isOpen, query, setQuery, toggle, close, openFromSidebar, dismissAfterInsert, onCommands, commands, kind: active?.kind };
}

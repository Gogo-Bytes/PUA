import { Input } from '../../ui';
import { useEffect, useRef, useState } from 'react';
import type { HistorySearchOptions, HistorySearchResult } from '../../../shared/ipc/desktop-api';
import { Button, Dialog, Icon } from '../../ui';

interface Props {
  open: boolean;
  onClose(): void;
  onSearch(options: HistorySearchOptions): Promise<HistorySearchResult[]>;
  onSelect(result: HistorySearchResult): void | Promise<void>;
  onError(message: string): void;
}

/** Main-owned full local history search; the dialog only renders safe result projections. */
export function HistorySearchDialog({ open, onClose, onSearch, onSelect, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    if (!open) return;
    setQuery(''); setResults([]); setSearched(false);
    const focus = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(focus);
  }, [open]);
  if (!open) return null;
  const search = async () => {
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true); setSearched(true);
    try { setResults(await onSearch({ query: value, limit: 40 })); }
    catch (error) { onError(String(error)); }
    finally { setLoading(false); }
  };
  return <Dialog open title="搜索全部历史" closeLabel="关闭历史搜索" closeOnBackdrop={false} onClose={onClose}>
    <form className="history-search-form" onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="history-search-input">搜索本机 Pi 会话</label>
      <div className="history-search-input-row"><Input ref={input} id="history-search-input" className="ui-input full-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目、任务消息或工具摘要…" /><Button type="submit" disabled={!query.trim() || loading}>{loading ? '搜索中…' : '搜索'}</Button></div>
      <p className="ui-meta">搜索活动、休眠和归档的本地历史；不会读取凭据、环境变量或扩展私有状态。</p>
    </form>
    <div className="history-search-results" aria-live="polite">
      {!searched && <p className="ui-meta">输入关键词开始搜索。</p>}
      {searched && !loading && !results.length && <p className="ui-meta">没有匹配的历史消息。</p>}
      {results.map(result => <Button key={`${result.taskId}:${result.entryId}`} variant="ghost" className="history-search-result" onClick={() => { void onSelect(result); onClose(); }}>
        <span className="history-search-result-icon"><Icon name="chat" /></span>
        <span className="history-search-result-copy"><strong>{result.title || '未命名任务'}</strong><small>{result.cwd} · {roleLabel(result.role)}{result.archived ? ' · 已归档' : ''}</small><span>{result.snippet}</span></span>
      </Button>)}
    </div>
  </Dialog>;
}

function roleLabel(role: HistorySearchResult['role']): string {
  return role === 'user' ? '用户' : role === 'assistant' ? 'Pi' : role === 'bashExecution' ? '命令' : role === 'summary' ? '摘要' : '扩展';
}

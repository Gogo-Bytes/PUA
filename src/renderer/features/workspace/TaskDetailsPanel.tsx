import { useEffect, useState } from 'react';
import type { RuntimeInfo, SessionInfo } from '../../../shared/ipc/desktop-api';
import { Button, Icon, StatusBadge, Tag } from '../../ui';
import { desktopClient, isDesktopAvailable } from '../../app/desktop-client';

export interface TaskDetailsPanelProps {
  task: SessionInfo;
  runtime: RuntimeInfo | null;
  onOpenProject(): void;
  onRename(): void;
  onArchive(): void | Promise<void>;
  onTogglePinned?(): void | Promise<void>;
}

/** Read-only task projection. Pi transcript and credentials remain outside the renderer. */
export function TaskDetailsPanel({ task, runtime, onOpenProject, onRename, onArchive, onTogglePinned }: TaskDetailsPanelProps) {
  const [busy, setBusy] = useState<'archive' | 'pin' | null>(null);
  const [autoSettings, setAutoSettings] = useState<{ autoCompaction: boolean; autoRetry: boolean } | null>(null);
  const [autoBusy, setAutoBusy] = useState<'compaction' | 'retry' | null>(null);
  useEffect(() => {
    let active = true;
    setAutoSettings(null);
    if (task.kind !== 'chat' || task.processStatus === 'exited' || !isDesktopAvailable()) return () => { active = false; };
    try { void desktopClient.getChatAutoSettings(task.id).then(value => { if (active) setAutoSettings(value); }).catch(() => { /* Pi may be unavailable while reconnecting. */ }); }
    catch { /* A test/legacy bridge may not expose the optional Pi policy RPC yet. */ }
    return () => { active = false; };
  }, [task.id, task.kind, task.processStatus]);
  const run = async (kind: 'archive' | 'pin', action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try { await action(); } finally { setBusy(null); }
  };
  const toggleAuto = async (kind: 'compaction' | 'retry', enabled: boolean) => {
    if (!autoSettings || autoBusy) return;
    setAutoBusy(kind);
    try {
      if (kind === 'compaction') await desktopClient.setChatAutoCompaction(task.id, enabled);
      else await desktopClient.setChatAutoRetry(task.id, enabled);
      setAutoSettings(current => current ? { ...current, [kind === 'compaction' ? 'autoCompaction' : 'autoRetry']: enabled } : current);
    } finally { setAutoBusy(null); }
  };
  const activity = task.activity === 'idle' ? '就绪' : task.activity === 'responding' ? '处理中' : task.activity === 'compacting' ? '压缩上下文' : task.activity === 'retrying' ? '重试中' : '等待输入';
  const process = task.processStatus === 'starting' ? '连接中' : task.processStatus === 'running' ? '运行中' : '已退出';
  return <section className="task-details-panel" aria-label="任务详情">
    <div className="task-details-heading"><div><span className="ui-meta">当前任务</span><h2>{task.title}</h2></div><Tag><Icon name={task.kind === 'terminal' ? 'terminal' : 'chat'}/>{task.kind === 'terminal' ? '兼容终端' : 'Pi 对话'}</Tag></div>
    <div className="task-details-actions">
      <Button variant="ghost" onClick={onRename}>重命名</Button>
      {onTogglePinned && <Button variant="ghost" busy={busy === 'pin'} disabled={!!busy && busy !== 'pin'} onClick={() => void run('pin', onTogglePinned)}>{task.pinned ? '取消置顶' : '置顶'}</Button>}
      <Button variant="danger" busy={busy === 'archive'} disabled={!!busy && busy !== 'archive'} onClick={() => void run('archive', onArchive)}>归档并关闭</Button>
    </div>
    <dl className="task-details-list">
      <div><dt>项目目录</dt><dd><button type="button" className="task-details-link" aria-label="打开项目目录" onClick={onOpenProject}>{task.cwd}</button></dd></div>
      <div><dt>进程状态</dt><dd><StatusBadge status={task.processStatus === 'running' ? 'running' : task.processStatus === 'starting' ? 'paused' : 'error'} label={process}/></dd></div>
      <div><dt>Pi 活动</dt><dd><Tag>{activity}</Tag></dd></div>
      <div><dt>最近活动</dt><dd>{task.lastActivityAt ? new Date(task.lastActivityAt).toLocaleString() : '暂无记录'}</dd></div>
      <div><dt>运行时</dt><dd>{runtime?.source ?? '未检测到 Pi 运行时'}</dd></div>
    </dl>
    {task.kind === 'chat' && <section className="task-details-settings" aria-label="Pi 自动策略">
      <div className="task-details-settings-heading"><strong>Pi 自动策略</strong><span className="ui-meta">由 Pi 当前会话控制</span></div>
      {!autoSettings ? <p className="task-details-note">正在读取当前策略…</p> : <>
        <label className="task-details-toggle"><input type="checkbox" checked={autoSettings.autoCompaction} disabled={!!autoBusy} onChange={event => void toggleAuto('compaction', event.target.checked)}/><span><strong>自动压缩上下文</strong><small>上下文接近上限时自动压缩，保持长任务可继续。</small></span></label>
        <label className="task-details-toggle"><input type="checkbox" checked={autoSettings.autoRetry} disabled={!!autoBusy} onChange={event => void toggleAuto('retry', event.target.checked)}/><span><strong>自动重试临时错误</strong><small>遇到限流或服务暂时不可用时由 Pi 自动重试。</small></span></label>
      </>}
    </section>}
    <p className="task-details-note">这里展示 PUA 当前持有的任务投影。消息历史、会话树、模型、Thinking Level 和扩展等待状态由 Pi 对话区按原生事件提供；不会复制或猜测 Pi 未提供的字段。</p>
    <p className="task-details-note">归档后可在桌面设置中恢复或永久删除。永久删除会同时清理对应 Pi 会话文件与 PUA 索引，无法恢复。</p>
  </section>;
}

import { useEffect, useState } from 'react';
import type { RuntimeInfo, SessionInfo } from '../../../shared/ipc/desktop-api';
import { desktopClient } from '../../app/desktop-client';
import { ChatPane } from '../conversation';
import { Icon } from '../../ui';

/**
 * A side chat is a real, separate Pi session. It deliberately does not enter
 * Workspace's main-session projection, so opening it cannot change the active
 * transcript or make the same ChatPane render in two places.
 */
export function SideChatPanel({ cwd, runtime, active, onError }: {
  cwd?: string;
  runtime: RuntimeInfo | null;
  active: boolean;
  onError(message: string): void;
}) {
  const [session, setSession] = useState<SessionInfo>();
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let mounted = true;
    let created: SessionInfo | undefined;
    const normalized = cwd?.trim();
    if (!normalized || !runtime) return () => { mounted = false; };
    setCreating(true);
    void desktopClient.createSession({ cwd: normalized, kind: 'chat', startMode: 'new', projectTrust: 'default', cols: 72, rows: 24 })
      .then(value => {
        created = value;
        if (mounted) setSession(value);
        else void desktopClient.closeSession(value.id).catch(() => {});
      })
      .catch(error => { if (mounted) onError(String(error)); })
      .finally(() => { if (mounted) setCreating(false); });
    return () => {
      mounted = false;
      if (created) void desktopClient.closeSession(created.id).catch(() => {});
    };
  }, [cwd, runtime, onError]);

  if (!cwd) return <EmptySideChat icon="folder" title="需要先选择项目" message="Side chat 使用当前项目目录启动独立 Pi 会话。" />;
  if (!runtime) return <EmptySideChat icon="settings" title="Pi 尚未配置" message="请先在桌面设置中配置本机 Pi。" />;
  if (creating || !session) return <EmptySideChat icon="chat" title="正在启动 Side chat" message="正在为侧栏创建独立 Pi 会话…" />;

  return <div className="workspace-side-chat">
    <ChatPane
      session={session}
      active={active}
      draft={draft}
      onDraftChange={setDraft}
      onError={onError}
      onCommands={() => {}}
    />
  </div>;
}

function EmptySideChat({ icon, title, message }: { icon: Parameters<typeof Icon>[0]['name']; title: string; message: string }) {
  return <div className="workspace-panel-unavailable workspace-side-chat-empty"><Icon name={icon}/><h2>{title}</h2><p>{message}</p></div>;
}

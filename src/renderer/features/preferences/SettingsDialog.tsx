import { Input, Slider } from '../../ui';
import { Button, Dialog } from '../../ui';
import { useSettingsDraft, type SettingsDraftOptions } from './useSettingsDraft';
import { desktopClient } from '../../app/desktop-client';
import { useEffect, useState } from 'react';

export type SettingsDialogProps = SettingsDraftOptions;

export function SettingsDialog({ boot, onClose, onSave }: SettingsDialogProps) {
  const { value, setValue, args, setArgs, error, busy, pick, save } = useSettingsDraft({ boot, onClose, onSave });
  const [archived, setArchived] = useState(boot.archivedSessions ?? []);
  const [busyArchive, setBusyArchive] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState('');
  useEffect(() => { setArchived(boot.archivedSessions ?? []); }, [boot.archivedSessions]);
  const refreshArchived = async () => {
    const next = await desktopClient.bootstrap();
    setArchived(next.archivedSessions ?? []);
    onSave(next);
  };
  const restore = async (id: string) => {
    setBusyArchive(id); setArchiveError('');
    try { await desktopClient.restoreArchivedSession(id); await refreshArchived(); }
    catch (error) { setArchiveError(String(error)); }
    finally { setBusyArchive(null); }
  };
  const remove = async (id: string) => {
    setBusyArchive(id); setArchiveError('');
    try { await desktopClient.deleteArchivedSession(id); setConfirmDelete(null); await refreshArchived(); }
    catch (error) { setArchiveError(String(error)); }
    finally { setBusyArchive(null); }
  };
  return <Dialog open title="桌面设置" closeLabel="关闭对话框" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <p className="muted">这里只管理桌面外壳。模型、凭据、工具和扩展继续由 Pi 配置。聊天模式的 mode/session/trust 参数由打开项目界面控制。</p>
      <label>外观</label>
      <div className="theme-options" role="group" aria-label="外观主题">
        {([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([theme, label]) => <Button type="button" key={theme} aria-pressed={(value.theme ?? 'system') === theme} onClick={() => setValue(current => ({ ...current, theme }))}>{label}</Button>)}
      </div>
      <p className="muted">保存后应用于工作台与终端，不重启会话。</p>
      <label>Pi 可执行文件 / CLI .js 路径</label>
      <div className="input-row">
        <Input className="ui-input" aria-label="Pi 路径" value={value.piPath} onChange={event => setValue({ ...value, piPath: event.target.value })} />
        <Button type="button" onClick={() => void pick('piPath')}>选择…</Button>
      </div>
      <label>Node.js 可执行文件（可选）</label>
      <div className="input-row">
        <Input className="ui-input" aria-label="Node.js 路径" value={value.nodePath} onChange={event => setValue({ ...value, nodePath: event.target.value })} />
        <Button type="button" onClick={() => void pick('nodePath')}>选择…</Button>
      </div>
      <label>附加 Pi CLI 参数 · JSON 字符串数组</label>
      <Input className="ui-input full-input mono" aria-label="Pi CLI 参数" value={args} onChange={event => setArgs(event.target.value)} />
      <label>终端字号 <output>{value.fontSize}px</output></label>
      <Slider className="range" aria-label="终端字号"  min="10" max="28" value={value.fontSize} onChange={event => setValue({ ...value, fontSize: Number(event.target.value) })} />
      <div className="runtime-card"><span>当前检测到的 Pi</span><code>{boot.runtime?.source || '未检测到'}</code><small>路径与参数修改仅影响新会话。</small></div>
      <section className="archived-session-settings" aria-label="归档会话">
        <h3>归档会话</h3>
        <p className="muted">归档不会删除 Pi 历史。恢复会重新接入原会话；永久删除会删除本地索引和对应 Pi 会话文件，无法恢复。</p>
        {!archived.length && <p className="ui-meta">暂无归档会话</p>}
        {archived.map(session => <div className="archived-session-row" key={session.id}>
          <span><strong>{session.title}</strong><small>{session.cwd}</small></span>
          <span className="archived-session-actions">
            <Button type="button" variant="ghost" disabled={busyArchive === session.id} onClick={() => void restore(session.id)}>{busyArchive === session.id ? '处理中…' : '恢复'}</Button>
            {confirmDelete === session.id ? <><Button type="button" variant="danger" disabled={busyArchive === session.id} onClick={() => void remove(session.id)}>确认永久删除</Button><Button type="button" variant="ghost" disabled={busyArchive === session.id} onClick={() => setConfirmDelete(null)}>取消</Button></> : <Button type="button" variant="danger" disabled={busyArchive !== null} onClick={() => setConfirmDelete(session.id)}>永久删除</Button>}
          </span>
        </div>)}
        {archiveError && <p role="alert" className="form-error">{archiveError}</p>}
      </section>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><Button type="button" onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</Button></div>
    </form>
  </Dialog>;
}

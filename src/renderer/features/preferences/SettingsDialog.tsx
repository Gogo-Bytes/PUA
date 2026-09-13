import { Button, Dialog } from '../../ui';
import { useSettingsDraft, type SettingsDraftOptions } from './useSettingsDraft';

export type SettingsDialogProps = SettingsDraftOptions;

export function SettingsDialog({ boot, onClose, onSave }: SettingsDialogProps) {
  const { value, setValue, args, setArgs, error, busy, pick, save } = useSettingsDraft({ boot, onClose, onSave });
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
        <input className="ui-input" aria-label="Pi 路径" value={value.piPath} onChange={event => setValue({ ...value, piPath: event.target.value })} />
        <Button type="button" onClick={() => void pick('piPath')}>选择…</Button>
      </div>
      <label>Node.js 可执行文件（可选）</label>
      <div className="input-row">
        <input className="ui-input" aria-label="Node.js 路径" value={value.nodePath} onChange={event => setValue({ ...value, nodePath: event.target.value })} />
        <Button type="button" onClick={() => void pick('nodePath')}>选择…</Button>
      </div>
      <label>附加 Pi CLI 参数 · JSON 字符串数组</label>
      <input className="ui-input full-input mono" aria-label="Pi CLI 参数" value={args} onChange={event => setArgs(event.target.value)} />
      <label>终端字号 <output>{value.fontSize}px</output></label>
      <input className="range" aria-label="终端字号" type="range" min="10" max="28" value={value.fontSize} onChange={event => setValue({ ...value, fontSize: Number(event.target.value) })} />
      <div className="runtime-card"><span>当前检测到的 Pi</span><code>{boot.runtime?.source || '未检测到'}</code><small>路径与参数修改仅影响新会话。</small></div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions"><Button type="button" onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存设置'}</Button></div>
    </form>
  </Dialog>;
}

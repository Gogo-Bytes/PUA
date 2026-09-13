import { useRef } from 'react';
import { Dialog } from '../../ui';
import { useNewSessionLaunch, type SessionLaunchOptions } from './useNewSessionLaunch';

export interface NewSessionDialogProps extends SessionLaunchOptions {
  hasRuntime: boolean;
  onClose(): void;
  onSettings(): void;
}

export function NewSessionDialog({ hasRuntime, onClose, onSettings, ...options }: NewSessionDialogProps) {
  const initialFocus = useRef<HTMLInputElement>(null);
  const { cwd, setCwd, kind, setKind, mode, setMode, trust, setTrust, resources, inspecting, inspection, busy, error, submit, chooseDirectory } = useNewSessionLaunch(options);
  return <Dialog initialFocusRef={initialFocus} open title="打开项目" closeLabel="关闭对话框" closeOnBackdrop={false} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label>项目文件夹</label>
      <div className="input-row">
        <input aria-label="项目文件夹" ref={initialFocus} value={cwd} onChange={event => setCwd(event.target.value)} required />
        <button type="button" onClick={chooseDirectory}>浏览…</button>
      </div>
      <label>界面</label>
      <div className="mode-options">
        {([['chat', '原生对话', '默认 · RPC 消息与工具卡片'], ['terminal', '兼容终端', '登录、设置和 TUI 专属扩展']] as const).map(([value, label, hint]) => <label key={value} className={kind === value ? 'chosen' : ''}>
          <input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} />
          <span>{label}<small>{hint}</small></span>
        </label>)}
      </div>
      <label>启动方式</label>
      <div className="mode-options">
        {([['new', '新会话', '开启独立会话'], ['continue', '继续最近', '恢复本项目最近会话'], ...(kind === 'terminal' ? [['resume', '选择历史', 'Pi 原生选择器'] as const] : [])] as const).map(([value, label, hint]) => <label key={value} className={mode === value ? 'chosen' : ''}>
          <input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)} />
          <span>{label}<small>{hint}</small></span>
        </label>)}
      </div>
      {kind === 'chat' && resources.length > 0 && <>
        <label>检测到项目资源</label>
        <div className="trust-options">
          {([['default', '沿用 Pi 已保存决定 / 全局默认'], ['approve', '本次信任并加载项目资源'], ['decline', '本次不加载项目资源']] as const).map(([value, label]) => <label key={value}>
            <input type="radio" name="trust" checked={trust === value} onChange={() => setTrust(value)} />{label}
          </label>)}
        </div>
        <p className="muted">RPC 不会显示 Pi 内置信任提示。PUA 不读取或修改 trust.json；“本次信任/不加载”只向这个进程传递对应参数。</p>
      </>}
      <p className="muted">兼容终端可在内部切换任意历史，因此必须独占：请先关闭其他会话，等待进程退出后再打开。</p>
      {kind === 'chat' && inspecting && <p>正在检查项目资源…</p>}
      {(error || inspection?.error) && <p role="alert" className="form-error">{error || inspection?.error}</p>}
      <div className="modal-actions">
        {!hasRuntime ? <button type="button" className="primary" onClick={onSettings}>先配置 Pi</button> : <button type="submit" className="primary" disabled={busy || !cwd.trim() || (kind === 'chat' && (inspecting || !!inspection?.error))}>{busy ? '正在打开…' : kind === 'chat' ? '开始对话 ↗' : '打开兼容终端 ↗'}</button>}
      </div>
    </form>
  </Dialog>;
}

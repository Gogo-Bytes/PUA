import { Input, Radio } from '../../ui';
import { useRef } from 'react';
import { Button, Dialog } from '../../ui';
import { useNewSessionLaunch, type SessionLaunchOptions } from './useNewSessionLaunch';

export interface NewSessionDialogProps extends SessionLaunchOptions {
  hasRuntime: boolean;
  onClose(): void;
  onSettings(): void;
}

export function NewSessionDialog({ hasRuntime, onClose, onSettings, ...options }: NewSessionDialogProps) {
  const initialFocus = useRef<HTMLInputElement>(null);
  const { cwd, setCwd, kind, setKind, mode, setMode, busy, error, submit, chooseDirectory, resources, trust, setTrust } = useNewSessionLaunch(options);
  const kinds = ([['chat', '原生对话', '默认 · RPC 消息与工具卡片'], ['terminal', '兼容终端', '登录、设置和 TUI 专属扩展']] as const);
  return <Dialog initialFocusRef={initialFocus} open title="打开项目" closeLabel="关闭对话框" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); submit(); }}>
      <label>项目文件夹</label>
      <div className="input-row">
        <Input className="ui-input" aria-label="项目文件夹" ref={initialFocus} value={cwd} onChange={event => setCwd(event.target.value)} required />
        <Button type="button" onClick={chooseDirectory}>浏览…</Button>
      </div>
      <label>界面</label>
      <div className="mode-options">
        {kinds.filter(([value]) => !options.fixedKind || value === options.fixedKind).map(([value, label, hint]) => <label key={value} className={kind === value ? 'chosen' : ''}>
          <Radio name="kind" checked={kind === value} disabled={!!options.fixedKind} onChange={() => setKind(value)} />
          <span>{label}<small>{hint}</small></span>
        </label>)}
      </div>
      <label>启动方式</label>
      <div className="mode-options">
        {([['new', '新会话', '开启独立会话'], ['continue', '继续最近', '恢复本项目最近会话'], ...(kind === 'terminal' ? [['resume', '选择历史', 'Pi 原生选择器'] as const] : [])] as const).map(([value, label, hint]) => <label key={value} className={mode === value ? 'chosen' : ''}>
          <Radio name="mode" checked={mode === value} onChange={() => setMode(value)} />
          <span>{label}<small>{hint}</small></span>
        </label>)}
      </div>
      <p className="muted">兼容终端可在内部切换任意历史，因此必须独占：请先关闭其他会话，等待进程退出后再打开。</p>
      {kind === 'chat' && resources && <fieldset className="trust-options">
        <legend>检测到项目资源</legend>
        <p className="muted">项目包含 Pi 技能、提示模板或扩展。请选择它们本次如何加载。</p>
        {([
          ['default', '沿用 Pi 保存的决定'],
          ['approve', '本次信任并加载项目资源'],
          ['decline', '本次不加载项目资源'],
        ] as const).map(([value, label]) => <label key={value} className={trust === value ? 'chosen' : ''}>
          <Radio name="project-trust" checked={trust === value} onChange={() => setTrust(value)} />
          <span>{label}</span>
        </label>)}
        <ul className="project-resource-paths">{resources.paths.map(path => <li key={path}>{path}</li>)}</ul>
      </fieldset>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-actions">
        {!hasRuntime ? <Button type="button" variant="primary" onClick={onSettings}>先配置 Pi</Button> : <Button type="submit" variant="primary" disabled={busy || !cwd.trim() || !!resources && trust === null}>{busy ? '正在检查…' : kind === 'chat' ? resources ? '按所选策略开始 ↗' : '开始对话 ↗' : '打开兼容终端 ↗'}</Button>}
      </div>
    </form>
  </Dialog>;
}

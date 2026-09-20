import { useEffect, useRef, useState } from 'react';
import type { ProjectTrust } from '../../../shared/ipc/conversation';
import type { ProjectResourceInfo } from '../../../shared/ipc/desktop-api';
import { desktopClient } from '../../app/desktop-client';
import { Button, Icon, Message } from '../../ui';
import { Composer } from './Composer';

interface Props {
  cwd: string;
  runtimeAvailable: boolean;
  value: string;
  onValueChange(value: string): void;
  onStart(value: string, trust: ProjectTrust, attachmentPaths: string[]): void | Promise<void>;
  onSettings(): void;
}

/** A project-scoped composer that has no Pi/session identity until its first send. */
export function PendingChatPane({ cwd, runtimeAvailable, value, onValueChange, onStart, onSettings }: Props) {
  const [inspection, setInspection] = useState<{ cwd: string; info?: ProjectResourceInfo; error?: string }>();
  const [trust, setTrust] = useState<ProjectTrust>('default');
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [skillDismissed, setSkillDismissed] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let current = true;
    setInspection(undefined); setTrust('default'); setAttachmentPaths([]); setSkillDismissed(false);
    const timer = setTimeout(() => {
      void desktopClient.inspectProjectResources(cwd).then(info => { if (current) setInspection({ cwd, info }); }).catch(error => { if (current) setInspection({ cwd, error: String(error) }); });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [cwd]);
  const resources = inspection?.cwd === cwd ? inspection.info?.paths ?? [] : [];
  const inspecting = inspection?.cwd !== cwd;
  const inspectionError = inspection?.cwd === cwd ? inspection.error : undefined;
  const skills = inspection?.cwd === cwd ? inspection.info?.skills ?? [] : [];
  const skillMatch = !skillDismissed ? value.match(/(?:^|\s)@([^\s]*)$/) : null;
  const skillSuggestions = skillMatch ? skills.filter(skill => skill.name.toLowerCase().includes(skillMatch[1].toLowerCase())).slice(0, 8) : [];
  const attachments = attachmentPaths.map(path => ({ id: path, name: path.split(/[\\/]/).pop() || path }));
  const addAttachments = async () => {
    try {
      const selected = await desktopClient.chooseAttachments();
      if (selected.length) setAttachmentPaths(current => [...new Set([...current, ...selected])].slice(0, 20));
    } catch (error) { /* Composer owns submission failures; picker cancellation is quiet. */ }
  };
  return <section className="pending-chat-pane" aria-label="新对话">
    <div className="pending-chat-intro"><Icon name="chat"/><h1>开始一个新对话</h1><p>{cwd}</p><span>此时还没有创建 Pi 会话。发送第一条消息后，才会保存为历史记录。</span></div>
    {resources.length > 0 && <div className="pending-trust" aria-label="项目资源信任">
      <strong>检测到项目资源</strong>
      <span>选择本次启动 Pi 时如何处理项目级技能和扩展：</span>
      {([['default', '沿用 Pi 已保存决定 / 全局默认'], ['approve', '本次加载项目资源'], ['decline', '本次不加载项目资源']] as const).map(([value, label]) => <label key={value}><input type="radio" name={`trust-${cwd}`} checked={trust === value} onChange={() => setTrust(value)}/>{label}</label>)}
    </div>}
    {inspecting && <p className="ui-meta pending-trust-status">正在检查项目资源…</p>}
    {inspectionError && <Message tone="error" toneLabel="项目资源检查失败">{inspectionError}</Message>}
    {!runtimeAvailable && <div className="pending-runtime-warning" role="status"><span>尚未配置 Pi。</span><Button variant="ghost" onClick={onSettings}>打开设置</Button></div>}
    <div className="pending-composer-wrap">
      {!!skillSuggestions.length && <div className="skill-menu" role="listbox" aria-label="技能建议">{skillSuggestions.map(skill => <Button key={skill.name} role="option" aria-selected="false" onClick={() => { const before = value.slice(0, value.length - (skillMatch?.[1].length ?? 0)); onValueChange(`${before.replace(/@$/, '')}@${skill.name} `); setSkillDismissed(true); editor.current?.focus(); }}><code>@{skill.name}</code><span>{skill.description || '项目技能'}</span></Button>)}</div>}
      <Composer conversationKey={`draft:${cwd}`} editorRef={editor} value={value} onValueChange={text => { onValueChange(text); setSkillDismissed(false); }} attachments={attachments} onAddAttachments={() => void addAttachments()} onRemoveAttachment={id => setAttachmentPaths(current => current.filter(path => path !== id))} onSend={async submission => { if (inspecting) throw new Error('正在检查项目资源，请稍后再发送'); if (inspectionError) throw new Error(inspectionError); await onStart(submission.value, trust, attachmentPaths); setAttachmentPaths([]); }} onEditorKeyDown={event => { if (event.key === 'Escape') setSkillDismissed(true); if (event.key === 'ArrowDown' && skillSuggestions.length) { event.preventDefault(); event.currentTarget.closest('.pending-composer-wrap')?.querySelector<HTMLButtonElement>('.skill-menu [role=option]')?.focus(); } }} labels={{ message: '发送消息', placeholder: '描述任务、粘贴内容或添加文件…', hint: 'Enter 发送 · ⇧Enter 换行', send: '发送消息', addAttachments: '添加附件', attachments: '附件', removeAttachment: name => `移除 ${name}`, queued: count => `${count} 已排队`, failed: '无法开始对话', error: '操作失败' }}/>
    </div>
  </section>;
}

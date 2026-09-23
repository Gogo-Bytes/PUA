import { useEffect, useRef, useState } from 'react';
import type { ProjectTrust } from '../../../shared/ipc/conversation';
import type { ProjectResourceInfo } from '../../../shared/ipc/desktop-api';
import { desktopClient } from '../../app/desktop-client';
import { Button, Icon } from '../../ui';
import { Composer } from './Composer';

interface Props {
  cwd: string;
  runtimeAvailable: boolean;
  value: string;
  onValueChange(value: string): void;
  stagedAttachmentPaths?: string[];
  onStagedAttachmentPathsChange?(paths: string[]): void;
  onStart(value: string, trust: ProjectTrust, attachmentPaths: string[]): void | Promise<void>;
  onSettings(): void;
}

/** A project-scoped composer that has no Pi/session identity until its first send. */
export function PendingChatPane({ cwd, runtimeAvailable, value, onValueChange, stagedAttachmentPaths = [], onStagedAttachmentPathsChange, onStart, onSettings }: Props) {
  const [inspection, setInspection] = useState<{ cwd: string; info?: ProjectResourceInfo; error?: string }>();
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const editor = useRef<HTMLTextAreaElement>(null);
  const attachmentSync = useRef(onStagedAttachmentPathsChange);
  const skipAttachmentSync = useRef(false);
  attachmentSync.current = onStagedAttachmentPathsChange;
  useEffect(() => {
    skipAttachmentSync.current = true;
    setInspection(undefined); setAttachmentPaths(stagedAttachmentPaths);
  }, [cwd]);
  useEffect(() => {
    if (!/[@/]/.test(value) || inspection?.cwd === cwd) return;
    let current = true;
    void desktopClient.inspectProjectResources(cwd).then(info => { if (current) setInspection({ cwd, info }); }).catch(error => { if (current) setInspection({ cwd, error: String(error) }); });
    return () => { current = false; };
  }, [cwd, value, inspection?.cwd]);
  useEffect(() => {
    if (skipAttachmentSync.current) { skipAttachmentSync.current = false; return; }
    attachmentSync.current?.(attachmentPaths);
  }, [cwd, attachmentPaths]);
  const resources = inspection?.cwd === cwd ? inspection.info?.paths ?? [] : [];
  const skills = inspection?.cwd === cwd ? inspection.info?.skills ?? [] : [];
  const prompts = inspection?.cwd === cwd ? inspection.info?.prompts ?? [] : [];
  const suggestions = [
    ...skills.map(skill => ({ id: `skill-${skill.name}`, atStartOnly: true, prefix: '@' as const, label: `@${skill.name}`, insertText: `@${skill.name}`, description: skill.description || '项目技能' })),
    ...resources.map(path => ({ id: `path-${path}`, prefix: '@' as const, label: `@${path}`, insertText: `@${JSON.stringify(path)}`, description: '项目文件' })),
    ...prompts.map(prompt => ({ id: `prompt-${prompt.name}`, prefix: '/' as const, label: `/${prompt.name}`, insertText: `/${prompt.name}`, description: '项目提示模板' })),
  ];
  const attachments = attachmentPaths.map(path => ({ id: path, name: path.split(/[\\/]/).pop() || path }));
  const addAttachments = async () => {
    try {
      const selected = await desktopClient.chooseAttachments();
      if (selected.length) setAttachmentPaths(current => [...new Set([...current, ...selected])].slice(0, 20));
    } catch (error) { /* Composer owns submission failures; picker cancellation is quiet. */ }
  };
  return <section className="pending-chat-pane" aria-label="新对话">
    <div className="pending-chat-intro"><Icon name="chat"/><h1>开始一个新对话</h1><p>{cwd}</p><span>此时还没有创建 Pi 会话。发送第一条消息后，才会保存为历史记录。</span></div>
    {!runtimeAvailable && <div className="pending-runtime-warning" role="status"><span>尚未配置 Pi。</span><Button variant="ghost" onClick={onSettings}>打开设置</Button></div>}
    <div className="pending-composer-wrap">
      <Composer suggestions={suggestions} conversationKey={`draft:${cwd}`} editorRef={editor} value={value} onValueChange={onValueChange} attachments={attachments} onAddAttachments={() => void addAttachments()} onRemoveAttachment={id => setAttachmentPaths(current => current.filter(path => path !== id))} onSend={async submission => { await onStart(submission.value, 'default', attachmentPaths); setAttachmentPaths([]); }} labels={{ message: '发送消息', placeholder: '描述任务、粘贴内容或添加文件…', hint: 'Enter 发送 · ⇧Enter 换行', send: '发送消息', addAttachments: '添加附件', attachments: '附件', removeAttachment: name => `移除 ${name}`, queued: count => `${count} 已排队`, failed: '无法开始对话', error: '操作失败' }}/>
    </div>
  </section>;
}

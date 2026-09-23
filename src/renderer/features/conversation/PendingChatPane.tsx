import { useEffect, useRef, useState } from 'react';
import type { ProjectTrust } from '../../../shared/ipc/conversation';
import type { ProjectResourceInfo } from '../../../shared/ipc/desktop-api';
import type { PiThinkingLevel } from '../../../shared/ipc/desktop-api';
import { Select } from '../../ui/ChoiceControls';
import { SearchSelect } from '../../ui/shadcn-search-select';
import type { ComposerSubmission } from './Composer';
import { desktopClient } from '../../app/desktop-client';
import { Button, Dialog, Icon } from '../../ui';
import { Composer } from './Composer';

interface Props {
  cwd: string;
  runtimeAvailable: boolean;
  value: string;
  onValueChange(value: string): void;
  stagedAttachmentPaths?: string[];
  onStagedAttachmentPathsChange?(paths: string[]): void;
  onStart(value: string, trust: ProjectTrust, attachmentPaths: string[], initial?: { model?: { provider: string; id: string }; thinkingLevel?: PiThinkingLevel }): void | Promise<void>;
  onSettings(): void;
}

/** A project-scoped composer that has no Pi/session identity until its first send. */
export function PendingChatPane({ cwd, runtimeAvailable, value, onValueChange, stagedAttachmentPaths = [], onStagedAttachmentPathsChange, onStart, onSettings }: Props) {
  const [inspection, setInspection] = useState<{ cwd: string; info?: ProjectResourceInfo; error?: string }>();
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [trustRequest, setTrustRequest] = useState<{ submission: ComposerSubmission; initial?: { model?: { provider: string; id: string }; thinkingLevel?: PiThinkingLevel } }>();
  const [catalog, setCatalog] = useState<{ cwd: string; models: import('../../../shared/ipc/conversation').ChatModel[] }>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [thinkingValue, setThinkingValue] = useState<PiThinkingLevel | ''>('');
  const catalogRequest = useRef(0);
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustError, setTrustError] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const attachmentSync = useRef(onStagedAttachmentPathsChange);
  const skipAttachmentSync = useRef(false);
  attachmentSync.current = onStagedAttachmentPathsChange;
  useEffect(() => {
    catalogRequest.current++;
    skipAttachmentSync.current = true;
    setInspection(undefined); setAttachmentPaths(stagedAttachmentPaths); setCatalog(undefined); setCatalogLoading(false); setCatalogError(''); setModelValue(''); setThinkingValue('');
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
  const models = catalog?.cwd === cwd ? catalog.models : [];
  const modelOptions = [{ value: '', label: 'Pi 默认模型' }, ...models.map(model => ({ value: `${model.provider}/${model.id}`, label: model.name || model.id }))];
  const thinkingOptions = [
    { value: '', label: 'Pi 默认思考程度' }, { value: 'off', label: '关闭' }, { value: 'minimal', label: '最小' },
    { value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' },
    { value: 'xhigh', label: '极高' }, { value: 'max', label: '最大' },
  ];
  const selectedModel = models.find(model => `${model.provider}/${model.id}` === modelValue);
  const changeModel = (value: string) => {
    setModelValue(value);
    if (value && models.find(model => `${model.provider}/${model.id}` === value)?.reasoning === false) setThinkingValue('');
  };
  const loadModelCatalog = () => {
    if (!runtimeAvailable || catalog?.cwd === cwd || catalogLoading) return;
    const request = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    void desktopClient.getChatModelCatalog().then(items => { if (catalogRequest.current === request) setCatalog({ cwd, models: items }); }).catch(error => { if (catalogRequest.current === request) setCatalogError(String(error)); }).finally(() => { if (catalogRequest.current === request) setCatalogLoading(false); });
  };
  const launchOptions = () => ({
    ...(selectedModel ? { model: { provider: selectedModel.provider, id: selectedModel.id } } : {}),
    ...(thinkingValue ? { thinkingLevel: thinkingValue } : {}),
  });
  const runtimeControls = <div className="chat-runtime-controls pending-runtime-controls">
    <SearchSelect label="模型" value={modelValue} options={modelOptions} disabled={!runtimeAvailable || catalogLoading}
      onOpenChange={open => { if (open) loadModelCatalog(); }} onChange={changeModel}/>
    <Select label="思考程度" value={thinkingValue} options={thinkingOptions}
      disabled={!runtimeAvailable || (modelValue !== '' && selectedModel?.reasoning === false)}
      onChange={value => setThinkingValue(value as PiThinkingLevel | '')}/>
    {catalogLoading && <span className="ui-meta" role="status">读取模型…</span>}
    {catalogError && <span className="ui-meta" role="status" title={catalogError}>模型目录不可用，将使用 Pi 默认模型</span>}
  </div>;
  const addAttachments = async () => {
    try {
      const selected = await desktopClient.chooseAttachments();
      if (selected.length) setAttachmentPaths(current => [...new Set([...current, ...selected])].slice(0, 20));
    } catch (error) { /* Composer owns submission failures; picker cancellation is quiet. */ }
  };
  const send = async (submission: import('./Composer').ComposerSubmission) => {
    const info = inspection?.cwd === cwd && inspection.info
      ? inspection.info
      : await desktopClient.inspectProjectResources(cwd);
    setInspection({ cwd, info });
    const selection = launchOptions();
    const initial = Object.keys(selection).length ? selection : undefined;
    if (info.hasResources) { setTrustRequest({ submission, initial }); setTrustError(''); return; }
    if (initial) await onStart(submission.value, 'default', attachmentPaths, initial);
    else await onStart(submission.value, 'default', attachmentPaths);
    setAttachmentPaths([]);
  };
  const startWithTrust = async (trust: ProjectTrust) => {
    if (!trustRequest || trustBusy) return;
    setTrustBusy(true); setTrustError('');
    try {
      if (trustRequest.initial) await onStart(trustRequest.submission.value, trust, attachmentPaths, trustRequest.initial);
      else await onStart(trustRequest.submission.value, trust, attachmentPaths);
      setTrustRequest(undefined); setAttachmentPaths([]);
    } catch (error) { setTrustError(String(error)); }
    finally { setTrustBusy(false); }
  };
  return <section className="pending-chat-pane" aria-label="新对话">
    <div className="pending-chat-intro"><Icon name="chat"/><h1>开始一个新对话</h1><p>{cwd}</p><span>此时还没有创建 Pi 会话。发送第一条消息后，才会保存为历史记录。</span></div>
    {!runtimeAvailable && <div className="pending-runtime-warning" role="status"><span>尚未配置 Pi。</span><Button variant="ghost" onClick={onSettings}>打开设置</Button></div>}
    <div className="pending-composer-wrap">
      <Composer suggestions={suggestions} conversationKey={`draft:${cwd}`} editorRef={editor} value={value} onValueChange={onValueChange}
        attachments={attachments} onAddAttachments={() => void addAttachments()}
        onRemoveAttachment={id => setAttachmentPaths(current => current.filter(path => path !== id))}
        onSend={send} footerControls={runtimeControls}
        labels={{ message: '发送消息', placeholder: '描述任务、粘贴内容或添加文件…', hint: 'Enter 发送 · ⇧Enter 换行', send: '发送消息', addAttachments: '添加附件', attachments: '附件', removeAttachment: name => `移除 ${name}`, queued: count => `${count} 已排队`, failed: '无法开始对话', error: '操作失败' }}/>
    </div>
    {trustRequest && <Dialog open title="检测到项目资源" closeLabel="稍后决定" closeDisabled={trustBusy} closeOnBackdrop={false} onClose={() => { setTrustRequest(undefined); setTrustError(''); }}>
      <p>此项目包含 Pi 技能、提示模板或扩展。选择这些项目资源本次如何加载。</p>
      {inspection?.cwd === cwd && inspection.info?.paths.length ? <ul className="project-resource-paths">{inspection.info.paths.map(path => <li key={path}>{path}</li>)}</ul> : null}
      {trustError && <p role="alert" className="form-error">{trustError}</p>}
      <div className="modal-actions project-trust-actions">
        <Button disabled={trustBusy} onClick={() => void startWithTrust('default')}>沿用 Pi 保存的决定</Button>
        <Button disabled={trustBusy} onClick={() => void startWithTrust('decline')}>本次不加载</Button>
        <Button variant="primary" busy={trustBusy} onClick={() => void startWithTrust('approve')}>本次信任并加载</Button>
      </div>
    </Dialog>}
  </section>;
}

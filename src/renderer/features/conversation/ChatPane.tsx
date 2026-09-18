import { desktopClient } from '../../app/desktop-client';
import { memo, useEffect, useReducer, useRef, useState } from 'react';
import { MarkdownView, CopyButton, SourceView } from '../content';
export { MarkdownView } from '../content';
import { Button, Collapsible, Dialog, Icon } from '../../ui';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatAttachment, ChatBlock, ChatCommand, ChatMessage, ChatSessionStats, ExtensionUIRequest, ExtensionUIResponse, ToolActivity } from '../../../shared/ipc/conversation';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { emptyChatState, queueText, reduceChatEvent, widgetsAt } from './chat-state';
import { missingAssistantRendererDiagnostics } from './missing-assistant-diagnostics';
import { ToolExecutionCard } from './ToolExecutionCard';
import { ChatMessage as ConversationMessage } from './ChatMessage';
import { Composer } from './Composer';
import { expandSkillReference } from './skill-references';

interface Props {
  session: SessionInfo;
  active: boolean;
  draft: string;
  onDraftChange(value: string): void;
  onError(message: string): void;
  onTerminalRecovery?(): void;
  onCommands(commands: ChatCommand[]): void;
  initialMessage?: string;
  onInitialMessageSent?(): void;
}

export function ChatPane({ session, active, draft, onDraftChange, onError, onCommands, onTerminalRecovery, initialMessage, onInitialMessageSent }: Props) {
  const [state, dispatch] = useReducer(reduceChatEvent, undefined, emptyChatState);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [models, setModels] = useState<import('../../../shared/ipc/conversation').ChatModel[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [sessionStats, setSessionStats] = useState<ChatSessionStats>();
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const sendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const recoveredRequests = useRef(new Set<string>());
  const draftRef = useRef({ text: draft, revision: 0 });
  if (draftRef.current.text !== draft) draftRef.current = { text: draft, revision: draftRef.current.revision + 1 };
  const callbacks = useRef({ onDraftChange, onError }); callbacks.current = { onDraftChange, onError };
  const changeDraft = (text: string) => { draftRef.current = { text, revision: draftRef.current.revision + 1 }; callbacks.current.onDraftChange(text); };
  const loadModels = () => { if (!models.length) void desktopClient.getChatAvailableModels(session.id).then(setModels).catch(error => onError(String(error))); };
  const loadThinkingLevels = () => { if (!thinkingLevels.length) void desktopClient.getChatThinkingLevels(session.id).then(setThinkingLevels).catch(error => onError(String(error))); };
  const [atBottom, setAtBottom] = useState(true);
  const list = useRef<VirtuosoHandle>(null);
  // Virtuoso treats a followOutput function as enabled for size changes even when it
  // returns false. Own height-following so streaming never overrides reader intent.
  const followOutput = useRef(true);
  const resumeAtBottom = useRef(false);
  const scrollFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current ?? 0), []);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [skillDismissed, setSkillDismissed] = useState(false);
  const forkingRef = useRef(false);
  const initialSentRef = useRef(false);
  const startedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = desktopClient.onSessionEvent(event => {
      if (event.id !== session.id) return;
      missingAssistantRendererDiagnostics.record('renderer-received', session.id, event);
      if (event.type === 'chat-queue-recovered') {
        if (!recoveredRequests.current.has(event.requestId)) {
          recoveredRequests.current.add(event.requestId);
          const restored = queueText(event.queue).join('\n\n');
          if (restored) changeDraft([draftRef.current.text, restored].filter(Boolean).join('\n\n'));
        }
      } else if (event.type === 'chat-editor-text') changeDraft(event.text);
      else dispatch(event);
    });
    return unsubscribe;
  }, [session.id]);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    void desktopClient.startSession(session.id).catch(error => { startedRef.current = false; onError(String(error)); });
  }, [active, session.id]);

  useEffect(() => {
    if (!missingAssistantRendererDiagnostics.enabled(session.id)) return;
    missingAssistantRendererDiagnostics.record('renderer-reduced', session.id, {
      type: 'chat-projection', message: [...state.messages].reverse().find(message => message.role === 'assistant') ?? state.messages.at(-1),
    });
  }, [state, session.id]);
  useEffect(() => onCommands(state.commands), [state.commands]);


  const busy = state.activity !== 'idle';
  const unavailable = state.exited || session.processStatus !== 'running';
  const send = async (delivery?: 'prompt' | 'steer' | 'followUp'): Promise<boolean> => {
    if (sendingRef.current || unavailable) return false;
    const submitted = { ...draftRef.current };
    const submittedIds = attachments.map(item => item.id);
    const value = submitted.text.trim(); if (!value && !attachments.length) return false;
    const mode = delivery ?? (busy ? 'steer' : 'prompt');
    sendingRef.current = true;
    try {
      await desktopClient.sendChatMessage(session.id, { text: expandSkillReference(submitted.text, state.commands), attachmentIds: submittedIds, delivery: mode });
      if (draftRef.current.revision === submitted.revision) changeDraft('');
      setAttachments(current => current.filter(item => !submittedIds.includes(item.id)));
    } catch (error) { onError(String(error)); return false; }
    finally { sendingRef.current = false; }
    return true;
  };
  const chooseAttachments = async () => {
    try { const selected = await desktopClient.chooseChatAttachments(session.id); setAttachments(current => [...current, ...selected]); }
    catch (error) { onError(String(error)); }
  };
  const stop = async () => {
    if (stoppingRef.current || unavailable) return;
    stoppingRef.current = true;
    try {
      await desktopClient.stopChat(session.id);
    } catch (error) { onError(String(error)); } finally { stoppingRef.current = false; }
  };
  const answerDialog = async (response: ExtensionUIResponse) => {
    try { await desktopClient.respondToExtensionUI(session.id, response); dispatch({ type: 'extension-ui-closed', id: session.id, requestId: response.id }); }
    catch (error) { onError(String(error)); }
  };
  const fork = async (entryId: string) => {
    if (forkingRef.current || unavailable) return;
    forkingRef.current = true;
    try { await desktopClient.forkChatSession(session.id, entryId); }
    catch (error) { onError(String(error)); }
    finally { forkingRef.current = false; }
  };
  const compact = async () => {
    if (sendingRef.current || unavailable || busy) return;
    sendingRef.current = true;
    try { await desktopClient.compactChatSession(session.id); }
    catch (error) { onError(String(error)); }
    finally { sendingRef.current = false; }
  };
  const showStats = async () => {
    if (statsLoading || unavailable) return;
    setStatsLoading(true);
    try { setSessionStats(await desktopClient.getChatSessionStats(session.id)); setStatsOpen(true); }
    catch (error) { onError(String(error)); }
    finally { setStatsLoading(false); }
  };

  useEffect(() => {
    if (!active || !state.ready || !initialMessage || initialSentRef.current) return;
    initialSentRef.current = true;
    void send('prompt').then(sent => {
      if (sent) onInitialMessageSent?.();
      else initialSentRef.current = false;
    });
  }, [active, state.ready, initialMessage]);

  const slash = !slashDismissed && draft.startsWith('/') ? state.commands.filter(command => `/${command.name} ${command.description ?? ''}`.toLowerCase().includes(draft.toLowerCase())).slice(0, 8) : [];
  const skillMatch = !skillDismissed ? draft.match(/(?:^|\s)@([^\s]*)$/) : null;
  const skills = skillMatch ? state.commands.filter(command => command.source === 'skill' && command.name.toLowerCase().includes(skillMatch[1].toLowerCase())).slice(0, 8) : [];
  return <section className={`chat-pane ${active ? 'active' : ''}`} aria-hidden={!active} data-session-id={session.id}>
    <div className="chat-exit-slot">
      {unavailable && session.processStatus === 'exited' && <div className="chat-exit-banner" role="alert">Pi 对话进程已退出。<Button onClick={onTerminalRecovery}>改用兼容终端</Button></div>}
    </div>
    <div className="chat-transcript" onWheelCapture={event => { if (event.deltaY < 0) { followOutput.current = false; resumeAtBottom.current = false; } else resumeAtBottom.current = true; }} onTouchMoveCapture={() => { followOutput.current = false; resumeAtBottom.current = true; }} onKeyDownCapture={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { followOutput.current = false; resumeAtBottom.current = false; } else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) resumeAtBottom.current = true; }} onPointerDownCapture={event => { if ((event.target as HTMLElement).dataset.virtuosoScroller) { followOutput.current = false; resumeAtBottom.current = true; } }}>
      {!state.ready && !state.exited && session.processStatus !== 'exited' && <div className="chat-loading"><span className="spinner" /> 正在连接本机 Pi RPC…</div>}
      {state.ready && state.messages.length === 0 && <div className="chat-empty"><Icon name="pi" /><h2>从一个具体问题开始</h2><p>描述任务，或添加文件作为上下文。Pi 在此项目中使用你的真实工具。</p></div>}
      <Virtuoso ref={list} className="message-list" data={state.messages} followOutput={false} atBottomStateChange={value => { setAtBottom(value); if (value && resumeAtBottom.current) followOutput.current = true; }} totalListHeightChanged={() => {
        cancelAnimationFrame(scrollFrame.current ?? 0);
        scrollFrame.current = requestAnimationFrame(() => { if (active && followOutput.current && state.messages.length) list.current?.scrollToIndex({ index: state.messages.length - 1, align: 'end', behavior: 'auto' }); });
      }} increaseViewportBy={500} itemContent={(_, message) => <MessageView message={message} onFork={fork} />} />
      {!atBottom && <Button className="jump-latest" onClick={() => { followOutput.current = true; list.current?.scrollToIndex({ index: Math.max(0, state.messages.length - 1), align: 'end', behavior: 'auto' }); }}>回到最新 ↓</Button>}
    </div>
    <div className="composer-area">
      {state.notices.slice(-3).map(notice => <div key={notice.id} className={`chat-notice ${notice.level}`}>{notice.message}</div>)}
      {widgetsAt(state.widgets, 'aboveEditor').map(widget => <div className="chat-widget" key={widget.key}>{widget.lines.map((line, index) => <div key={index}>{line}</div>)}</div>)}
      {!!queueText(state.queue).length && <div className="queue-strip"><strong>已排队</strong>{state.queue.steering.map((text, index) => <span key={`s${index}`}>引导 · {text}</span>)}{state.queue.followUp.map((text, index) => <span key={`f${index}`}>后续 · {text}</span>)}</div>}
      {!!slash.length && <div className="slash-menu" aria-label="Pi 命令建议" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setSlashDismissed(true); textarea.current?.focus(); } if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]; const index = items.indexOf(event.target as HTMLButtonElement); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } }}> {slash.map(command => <Button key={command.name} onClick={() => { changeDraft(`/${command.name} `); setSlashDismissed(true); textarea.current?.focus(); }}><code>/{command.name}</code><span>{command.description || command.source}</span></Button>)}</div>}
      {!!skills.length && <div className="skill-menu" role="listbox" aria-label="技能建议" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setSkillDismissed(true); textarea.current?.focus(); } if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]')]; const index = items.indexOf(event.target as HTMLButtonElement); items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } }}> {skills.map(command => <Button key={command.name} role="option" aria-selected="false" onClick={() => { const before = draft.slice(0, draft.length - (skillMatch?.[1].length ?? 0)); const name = command.name.replace(/^skill:/, ''); changeDraft(`${before.replace(/@$/, '')}@${name} `); setSkillDismissed(true); textarea.current?.focus(); }}><code>@{command.name.replace(/^skill:/, '')}</code><span>{command.description || '@ Pi 技能'}</span></Button>)}</div>}
      <div className="chat-runtime-controls"><select aria-label="模型" value={state.model ? `${state.model.provider}/${state.model.id}` : ''} onFocus={loadModels} onChange={event => { const [provider, ...rest] = event.target.value.split('/'); void desktopClient.setChatModel(session.id, provider, rest.join('/')).catch(error => onError(String(error))); }}>{!state.model && <option value="">模型</option>}{models.map(model => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.name || model.id}</option>)}</select><select aria-label="Thinking Level" value={state.thinkingLevel || ''} onFocus={loadThinkingLevels} onChange={event => { if (event.target.value) void desktopClient.setChatThinkingLevel(session.id, event.target.value).catch(error => onError(String(error))); }}><option value="">Thinking</option>{thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select><Button variant="ghost" disabled={busy || unavailable} onClick={() => void compact()}>压缩上下文</Button><Button variant="ghost" disabled={statsLoading || unavailable} onClick={() => void showStats()}>{statsLoading ? '读取统计…' : '会话统计'}</Button></div>
      {state.sessionTree?.length ? <div className="chat-session-tree" aria-label="会话分支历史"><strong>分支历史</strong><TreeNodes nodes={state.sessionTree} onFork={entryId => void fork(entryId)} /></div> : null}
      <Composer conversationKey={session.id} editorRef={textarea} disabled={unavailable} value={draft}
        attachments={attachments.map(item => ({ id: item.id, name: item.name, detail: <>{item.previewUrl && <img className="attachment-preview" src={item.previewUrl} alt=""/>}{formatBytes(item.size)}</> }))}
        onAddAttachments={() => void chooseAttachments()}
        onRemoveAttachment={id => void desktopClient.removeChatAttachment(session.id, id).then(() => setAttachments(current => current.filter(item => item.id !== id))).catch(error => onError(String(error)))}
        onValueChange={value => { changeDraft(value); setSlashDismissed(false); setSkillDismissed(false); }}
        busy={busy} onSend={() => { void send(); }} onQueue={() => { void send('steer'); }} onFollowUp={() => { void send('followUp'); }} onStop={stop}
        labels={{ message: '发送消息', placeholder: busy ? '输入可在当前工具完成后引导 Pi…' : '描述任务、粘贴内容或添加文件…', hint: busy ? 'Enter 引导 · ⌥Enter 后续 · ⇧Enter 换行' : 'Enter 发送 · ⇧Enter 换行', send: '发送消息', queue: '引导 Pi', stop: '停止运行', addAttachments: '添加附件', attachments: '附件', removeAttachment: name => `移除 ${name}`, failed: '操作失败', error: '操作失败' }}
        onEditorKeyDown={event => {
          if (event.key === 'Escape') { setSlashDismissed(true); setSkillDismissed(true); return; }
          if (event.key === 'ArrowDown' && slash.length) { event.preventDefault(); event.currentTarget.closest('.composer-area')?.querySelector<HTMLButtonElement>('.slash-menu button')?.focus(); }
          if (event.key === 'ArrowDown' && skills.length) { event.preventDefault(); event.currentTarget.closest('.composer-area')?.querySelector<HTMLButtonElement>('.skill-menu [role=option]')?.focus(); }
        }} />
      {widgetsAt(state.widgets, 'belowEditor').map(widget => <div className="chat-widget" key={widget.key}>{widget.lines.map((line, index) => <div key={index}>{line}</div>)}</div>)}
      <div className="chat-meta"><span>{state.exited || session.processStatus === 'exited' ? 'Pi 已退出' : session.processStatus === 'starting' || !state.ready ? '正在连接 Pi…' : activityLabel(state.activity)}</span><span>{state.model ? `${state.model.provider}/${state.model.id}` : '未选择模型'}{state.thinkingLevel ? ` · ${state.thinkingLevel}` : ''}</span>{Object.entries(state.statuses).map(([key, value]) => <span key={key}>{value}</span>)}</div>
    </div>
    {active && state.dialog && <ExtensionDialog key={state.dialog.id} request={state.dialog} onAnswer={answerDialog} />}
    {active && statsOpen && sessionStats && <SessionStatsDialog stats={sessionStats} onClose={() => setStatsOpen(false)} />}
  </section>;
}

function SessionStatsDialog({ stats, onClose }: { stats: ChatSessionStats; onClose(): void }) {
  const context = stats.contextUsage;
  return <Dialog open title="Pi 会话统计" closeLabel="关闭" onClose={onClose}>
    <div className="session-stats" aria-label="Pi 会话统计">
      <dl><div><dt>用户消息</dt><dd>{stats.userMessages}</dd></div><div><dt>Pi 回复</dt><dd>{stats.assistantMessages}</dd></div><div><dt>工具调用</dt><dd>{stats.toolCalls}</dd></div><div><dt>工具结果</dt><dd>{stats.toolResults}</dd></div><div><dt>消息总数</dt><dd>{stats.totalMessages}</dd></div><div><dt>估算成本</dt><dd>{stats.cost}</dd></div></dl>
      <p>Token：输入 {stats.tokens.input} · 输出 {stats.tokens.output} · 缓存读 {stats.tokens.cacheRead} · 缓存写 {stats.tokens.cacheWrite} · 总计 {stats.tokens.total}</p>
      {context && <p>上下文：{context.tokens === null ? '未知' : context.tokens} / {context.contextWindow} token{context.percent === null ? '' : `（${context.percent.toFixed(1)}%）`}</p>}
      <p className="ui-meta">数据由当前 Pi 会话原生统计提供，不代表账户级或云端用量。</p>
    </div>
  </Dialog>;
}

function TreeNodes({ nodes, onFork, depth = 0 }: { nodes: readonly import('../../../shared/ipc/conversation').ChatTreeNode[]; onFork(entryId: string): void; depth?: number }) {
  return <ul style={{ marginLeft: depth * 12 }}>{nodes.map(node => <li key={node.entryId}>{node.forkable === false ? <span className="chat-tree-label">{node.label || node.entryId}</span> : <Button variant="ghost" onClick={() => onFork(node.entryId)} title="从此历史节点创建分支">↗ {node.label || node.entryId}</Button>}{node.children.length ? <TreeNodes nodes={node.children} onFork={onFork} depth={depth + 1}/> : null}</li>)}</ul>;
}

const MessageView = memo(function MessageView({ message, onFork }: { message: ChatMessage; onFork(entryId: string): void }) {
  const text = message.blocks.filter((block): block is Extract<ChatBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n');
  const author = message.role === 'user' ? '你' : message.role === 'assistant' ? 'Pi' : message.label || '事件';
  const actions = (message.role === 'assistant' && text) || message.forkEntryId ? <>{message.role === 'assistant' && text ? <CopyButton text={text} label="复制回复" /> : null}{message.forkEntryId ? <Button variant="ghost" onClick={() => onFork(message.forkEntryId!)} aria-label="从此消息创建分支" title="从此消息创建分支"><Icon name="fork"/>分支</Button> : null}</> : undefined;
  return <ConversationMessage role={message.role} author={author} error={message.error} streaming={!!message.streaming} labels={{ user: '你', assistant: 'Pi', streaming: '正在回复…', failed: '回复失败' }} actions={actions}>
    {message.blocks.map((block, index) => block.type === 'text' ? message.role === 'user' ? <div className="user-text" key={index}>{block.text}</div> : <MarkdownView key={index} text={block.text} streaming={!!message.streaming} /> : block.type === 'thinking' ? <Collapsible title="思考过程" key={index}><MarkdownView text={block.text} streaming={!!message.streaming} /></Collapsible> : block.type === 'image' ? <img className="transcript-image" key={index} alt="消息图片" src={`data:${block.mimeType};base64,${block.data}`} /> : <ToolCard key={block.tool.id} tool={block.tool} />)}
  </ConversationMessage>;
});

export function ToolCard({ tool }: { tool: ToolActivity }) {
  const status = tool.status === 'pending' ? 'idle' : tool.status;
  return <ToolExecutionCard status={status} className={tool.status} openOnError title={toolSummary(tool)} icon={<Icon name={tool.status === 'success' ? 'check' : tool.status === 'error' ? 'close' : 'code'}/>} labels={{ statuses: { idle: '等待', running: '运行中', success: '完成', error: '失败' } }}><div className="tool-detail"><div className="tool-detail-label">{tool.name} · 调用参数</div><pre>{JSON.stringify(tool.arguments, null, 2)}</pre>{tool.images?.map((image, index) => <img className="transcript-image" key={index} alt="工具结果图片" src={`data:${image.mimeType};base64,${image.data}`} />)}{tool.output && <><div className="tool-output-heading"><span>工具返回快照 · {tool.output.split('\n').length} 行输出</span><CopyButton text={tool.output} label="复制工具输出" /></div><p className="snapshot-note">该次执行返回的内容，不代表当前磁盘文件；行号为输出行号。</p><SourceView text={tool.output} label="工具返回快照" /></>}</div></ToolExecutionCard>;
}

export function ExtensionDialog({ request, onAnswer }: { request: ExtensionUIRequest; onAnswer(value: ExtensionUIResponse): Promise<void> }) {
  const initialFocus = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (response: ExtensionUIResponse) => { if (submitting) return; setSubmitting(true); try { await onAnswer(response); } finally { setSubmitting(false); } };
  const [value, setValue] = useState(request.method === 'editor' ? request.prefill ?? '' : '');
  return <Dialog initialFocusRef={initialFocus} open title={request.title} closeLabel="取消" closeDisabled={submitting} closeOnBackdrop={false} onClose={() => void submit({ id: request.id, cancelled: true })}><fieldset disabled={submitting}>{request.method === 'confirm' && <p>{request.message}</p>}{request.method === 'select' ? <div className="extension-options">{request.options.map(option => <Button key={option} onClick={() => void submit({ id: request.id, value: option })}>{option}</Button>)}</div> : request.method === 'confirm' ? <div className="extension-actions"><Button onClick={() => void submit({ id: request.id, confirmed: false })}>取消</Button><Button variant="primary" onClick={() => void submit({ id: request.id, confirmed: true })}>确认</Button></div> : <form onSubmit={event => { event.preventDefault(); void submit({ id: request.id, value }); }}><textarea className="ui-input" ref={initialFocus} aria-label={request.title} placeholder={request.method === 'input' ? request.placeholder : undefined} value={value} onChange={event => setValue(event.target.value)} /><div className="extension-actions"><Button type="button" onClick={() => void submit({ id: request.id, cancelled: true })}>取消</Button><Button variant="primary" type="submit">提交</Button></div></form>}</fieldset></Dialog>;
}

function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }
function activityLabel(activity: string): string { return activity === 'responding' ? 'Pi 正在处理' : activity === 'compacting' ? '正在压缩上下文' : activity === 'retrying' ? '正在重试' : activity === 'waiting-input' ? '等待你的选择' : 'Pi 已就绪'; }
function toolSummary(tool: ToolActivity): string { const args = tool.arguments; const value = (...keys: string[]) => keys.map(key => args[key]).find(item => typeof item === 'string') as string | undefined; if (tool.name === 'bash' || tool.name === 'powershell') return `运行 · ${value('command') || tool.name}`; if (tool.name === 'read') return `读取 · ${value('path') || ''}`; if (tool.name === 'write') return `写入 · ${value('path') || ''}`; if (tool.name === 'edit') return `编辑 · ${value('path') || ''}`; if (tool.name === 'grep') return `搜索 · ${value('pattern') || ''}`; if (tool.name === 'find') return `查找 · ${value('pattern') || ''}`; if (tool.name === 'ls') return `列出 · ${value('path') || '.'}`; return tool.name; }

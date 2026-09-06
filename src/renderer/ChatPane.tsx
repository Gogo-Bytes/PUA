import { memo, useEffect, useReducer, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import remend from 'remend';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatAttachment, ChatBlock, ChatCommand, ChatMessage, ExtensionUIRequest, ExtensionUIResponse, ToolActivity } from '../shared/chat';
import type { SessionInfo } from '../shared/contracts';
import { emptyChatState, queueText, reduceChatEvent, widgetsAt } from './chat-state';
import 'highlight.js/styles/github-dark-dimmed.css';

interface Props {
  session: SessionInfo;
  active: boolean;
  draft: string;
  onDraftChange(value: string): void;
  onError(message: string): void;
  onTerminalRecovery?(): void;
  onCommands(commands: ChatCommand[]): void;
}

export function ChatPane({ session, active, draft, onDraftChange, onError, onCommands, onTerminalRecovery }: Props) {
  const [state, dispatch] = useReducer(reduceChatEvent, undefined, emptyChatState);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const stoppingRef = useRef(false);
  const recoveredRequests = useRef(new Set<string>());
  const draftRef = useRef({ text: draft, revision: 0 });
  if (draftRef.current.text !== draft) draftRef.current = { text: draft, revision: draftRef.current.revision + 1 };
  const callbacks = useRef({ onDraftChange, onError }); callbacks.current = { onDraftChange, onError };
  const changeDraft = (text: string) => { draftRef.current = { text, revision: draftRef.current.revision + 1 }; callbacks.current.onDraftChange(text); };
  const [atBottom, setAtBottom] = useState(true);
  const list = useRef<VirtuosoHandle>(null);
  // Virtuoso treats a followOutput function as enabled for size changes even when it
  // returns false. Own height-following so streaming never overrides reader intent.
  const followOutput = useRef(true);
  const resumeAtBottom = useRef(false);
  const scrollFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current ?? 0), []);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unsubscribe = window.desktop.onSessionEvent(event => {
      if (event.id !== session.id) return;
      if (event.type === 'chat-queue-recovered') {
        if (!recoveredRequests.current.has(event.requestId)) {
          recoveredRequests.current.add(event.requestId);
          const restored = queueText(event.queue).join('\n\n');
          if (restored) changeDraft([draftRef.current.text, restored].filter(Boolean).join('\n\n'));
        }
      } else if (event.type === 'chat-editor-text') changeDraft(event.text);
      else dispatch(event);
    });
    void window.desktop.startSession(session.id).catch(error => onError(String(error)));
    return unsubscribe;
  }, [session.id]);

  useEffect(() => onCommands(state.commands), [state.commands]);
  useEffect(() => {
    const node = textarea.current; if (!node) return;
    node.style.height = '0'; node.style.height = `${Math.min(220, Math.max(54, node.scrollHeight))}px`;
  }, [draft]);

  const busy = state.activity !== 'idle';
  const unavailable = state.exited || session.processStatus !== 'running';
  const send = async (delivery?: 'prompt' | 'steer' | 'followUp') => {
    if (sendingRef.current || unavailable) return;
    const submitted = { ...draftRef.current };
    const submittedIds = attachments.map(item => item.id);
    const value = submitted.text.trim(); if (!value && !attachments.length) return;
    const mode = delivery ?? (busy ? 'steer' : 'prompt');
    sendingRef.current = true; setSending(true);
    try {
      await window.desktop.sendChatMessage(session.id, { text: submitted.text, attachmentIds: submittedIds, delivery: mode });
      if (draftRef.current.revision === submitted.revision) changeDraft('');
      setAttachments(current => current.filter(item => !submittedIds.includes(item.id)));
    } catch (error) { onError(String(error)); }
    finally { sendingRef.current = false; setSending(false); }
  };
  const chooseAttachments = async () => {
    try { const selected = await window.desktop.chooseChatAttachments(session.id); setAttachments(current => [...current, ...selected]); }
    catch (error) { onError(String(error)); }
  };
  const stop = async () => {
    if (stoppingRef.current || unavailable) return;
    stoppingRef.current = true;
    try {
      await window.desktop.stopChat(session.id);
    } catch (error) { onError(String(error)); } finally { stoppingRef.current = false; }
  };
  const answerDialog = async (response: ExtensionUIResponse) => {
    try { await window.desktop.respondToExtensionUI(session.id, response); dispatch({ type: 'extension-ui-closed', id: session.id, requestId: response.id }); }
    catch (error) { onError(String(error)); }
  };

  const slash = draft.startsWith('/') ? state.commands.filter(command => `/${command.name} ${command.description ?? ''}`.toLowerCase().includes(draft.toLowerCase())).slice(0, 8) : [];
  return <section className={`chat-pane ${active ? 'active' : ''}`} aria-hidden={!active} data-session-id={session.id}>
    <div className="chat-exit-slot">
      {unavailable && session.processStatus === 'exited' && <div className="chat-exit-banner" role="alert">Pi 对话进程已退出。<button onClick={onTerminalRecovery}>改用兼容终端</button></div>}
    </div>
    <div className="chat-transcript" onWheelCapture={event => { if (event.deltaY < 0) { followOutput.current = false; resumeAtBottom.current = false; } else resumeAtBottom.current = true; }} onTouchMoveCapture={() => { followOutput.current = false; resumeAtBottom.current = true; }} onKeyDownCapture={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) { followOutput.current = false; resumeAtBottom.current = false; } else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) resumeAtBottom.current = true; }} onPointerDownCapture={event => { if ((event.target as HTMLElement).dataset.virtuosoScroller) { followOutput.current = false; resumeAtBottom.current = true; } }}>
      {!state.ready && !state.exited && session.processStatus !== 'exited' && <div className="chat-loading"><span className="spinner" /> 正在连接本机 Pi RPC…</div>}
      {state.ready && state.messages.length === 0 && <div className="chat-empty"><span>π</span><h2>从需求开始</h2><p>Pi 将在你的项目中读取、修改和运行工具。消息、工具活动与结果会在这里清晰呈现。</p></div>}
      <Virtuoso ref={list} className="message-list" data={state.messages} followOutput={false} atBottomStateChange={value => { setAtBottom(value); if (value && resumeAtBottom.current) followOutput.current = true; }} totalListHeightChanged={() => {
        cancelAnimationFrame(scrollFrame.current ?? 0);
        scrollFrame.current = requestAnimationFrame(() => { if (active && followOutput.current && state.messages.length) list.current?.scrollToIndex({ index: state.messages.length - 1, align: 'end', behavior: 'auto' }); });
      }} increaseViewportBy={500} itemContent={(_, message) => <MessageView message={message} />} />
      {!atBottom && <button className="jump-latest" onClick={() => { followOutput.current = true; list.current?.scrollToIndex({ index: Math.max(0, state.messages.length - 1), align: 'end', behavior: 'auto' }); }}>回到最新 ↓</button>}
    </div>
    <div className="composer-area">
      {state.notices.slice(-3).map(notice => <div key={notice.id} className={`chat-notice ${notice.level}`}>{notice.message}</div>)}
      {widgetsAt(state.widgets, 'aboveEditor').map(widget => <div className="chat-widget" key={widget.key}>{widget.lines.map((line, index) => <div key={index}>{line}</div>)}</div>)}
      {!!queueText(state.queue).length && <div className="queue-strip"><strong>已排队</strong>{state.queue.steering.map((text, index) => <span key={`s${index}`}>引导 · {text}</span>)}{state.queue.followUp.map((text, index) => <span key={`f${index}`}>后续 · {text}</span>)}</div>}
      {!!slash.length && <div className="slash-menu">{slash.map(command => <button key={command.name} onClick={() => changeDraft(`/${command.name} `)}><code>/{command.name}</code><span>{command.description || command.source}</span></button>)}</div>}
      <div className="composer">
        {!!attachments.length && <div className="attachment-list">{attachments.map(item => <div className="attachment-chip" key={item.id}>{item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span>⌁</span>}<div>{item.name}<small>{formatBytes(item.size)}</small></div><button aria-label={`移除 ${item.name}`} onClick={() => void window.desktop.removeChatAttachment(session.id, item.id).then(() => setAttachments(current => current.filter(value => value.id !== item.id))).catch(error => onError(String(error)))}>×</button></div>)}</div>}
        <textarea disabled={unavailable} ref={textarea} aria-label="发送消息" placeholder={busy ? '输入可在当前工具完成后引导 Pi…' : '描述任务、粘贴内容或添加文件…'} value={draft} onChange={event => changeDraft(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault(); void send(event.altKey && busy ? 'followUp' : undefined);
        }} />
        <div className="composer-actions"><div><button disabled={unavailable} aria-label="添加附件" title="添加文件或图片" onClick={() => void chooseAttachments()}>＋</button><span>{busy ? 'Enter 引导 · ⌥Enter 后续 · ⇧Enter 换行' : 'Enter 发送 · ⇧Enter 换行'}</span></div>{busy ? <button className="stop-button" onClick={() => void stop()}><i /> 停止</button> : <button className="send-button" onClick={() => void send()} disabled={unavailable || sending || (!draft.trim() && !attachments.length)}>发送 ↑</button>}</div>
      </div>
      {widgetsAt(state.widgets, 'belowEditor').map(widget => <div className="chat-widget" key={widget.key}>{widget.lines.map((line, index) => <div key={index}>{line}</div>)}</div>)}
      <div className="chat-meta"><span>{state.exited || session.processStatus === 'exited' ? 'Pi 已退出' : session.processStatus === 'starting' || !state.ready ? '正在连接 Pi…' : activityLabel(state.activity)}</span><span>{state.model ? `${state.model.provider}/${state.model.id}` : '未选择模型'}{state.thinkingLevel ? ` · ${state.thinkingLevel}` : ''}</span>{Object.entries(state.statuses).map(([key, value]) => <span key={key}>{value}</span>)}</div>
    </div>
    {active && state.dialog && <ExtensionDialog key={state.dialog.id} request={state.dialog} onAnswer={answerDialog} />}
  </section>;
}

const MessageView = memo(function MessageView({ message }: { message: ChatMessage }) {
  const text = message.blocks.filter((block): block is Extract<ChatBlock, { type: 'text' }> => block.type === 'text').map(block => block.text).join('\n');
  return <article className={`chat-message ${message.role}`}>
    <header><span>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Pi' : message.label || '事件'}</span>{message.role === 'assistant' && text && <CopyButton text={text} label="复制回复" />}</header>
    <div className="message-body">{message.blocks.map((block, index) => block.type === 'text' ? message.role === 'user' ? <div className="user-text" key={index}>{block.text}</div> : <MarkdownView key={index} text={block.text} streaming={!!message.streaming} /> : block.type === 'thinking' ? <details className="thinking" key={index}><summary>思考过程</summary><MarkdownView text={block.text} streaming={!!message.streaming} /></details> : block.type === 'image' ? <img className="transcript-image" key={index} alt="消息图片" src={`data:${block.mimeType};base64,${block.data}`} /> : <ToolCard key={block.tool.id} tool={block.tool} />)}{message.error && <div className="message-error">{message.error}</div>}</div>
  </article>;
});

export function MarkdownView({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const source = streaming ? remend(text, { images: false, links: true }) : text;
  return <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) void window.desktop.openExternal(href).catch(() => {}); }}>{children}</a>,
    img: ({ alt }) => <span className="remote-image">[远程图片未自动加载{alt ? `：${alt}` : ''}]</span>,
    pre: ({ children }) => { const value = nodeText(children); return <div className="code-block"><CopyButton text={value} label="复制代码" /><pre>{children}</pre></div>; },
  }}>{source}</Markdown>;
}

export function ToolCard({ tool }: { tool: ToolActivity }) {
  const [open, setOpen] = useState(tool.status === 'error');
  useEffect(() => { if (tool.status === 'error') setOpen(true); }, [tool.status]);
  return <details className={`tool-card ${tool.status}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span className="tool-status" /><strong>{toolSummary(tool)}</strong><small>{tool.status === 'running' ? '运行中' : tool.status === 'success' ? '完成' : tool.status === 'error' ? '失败' : '等待'}</small></summary><div className="tool-detail"><pre>{JSON.stringify(tool.arguments, null, 2)}</pre>{tool.images?.map((image, index) => <img className="transcript-image" key={index} alt="工具结果图片" src={`data:${image.mimeType};base64,${image.data}`} />)}{tool.output && <><CopyButton text={tool.output} label="复制工具输出" /><pre>{tool.output}</pre></>}</div></details>;
}

export function ExtensionDialog({ request, onAnswer }: { request: ExtensionUIRequest; onAnswer(value: ExtensionUIResponse): Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (response: ExtensionUIResponse) => { if (submitting) return; setSubmitting(true); try { await onAnswer(response); } finally { setSubmitting(false); } };
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { ref.current?.close(); previous?.focus(); }; }, []);
  const [value, setValue] = useState(request.method === 'editor' ? request.prefill ?? '' : '');
  return <dialog ref={ref} className="extension-dialog" onCancel={event => { event.preventDefault(); void submit({ id: request.id, cancelled: true }); }} aria-modal="true" aria-labelledby={`extension-${request.id}`}><fieldset disabled={submitting}><header><h2 id={`extension-${request.id}`}>{request.title}</h2><button aria-label="取消" onClick={() => void submit({ id: request.id, cancelled: true })}>×</button></header>{request.method === 'confirm' && <p>{request.message}</p>}{request.method === 'select' ? <div className="extension-options">{request.options.map(option => <button key={option} onClick={() => void submit({ id: request.id, value: option })}>{option}</button>)}</div> : request.method === 'confirm' ? <div className="extension-actions"><button onClick={() => void submit({ id: request.id, confirmed: false })}>取消</button><button className="primary" onClick={() => void submit({ id: request.id, confirmed: true })}>确认</button></div> : <form onSubmit={event => { event.preventDefault(); void submit({ id: request.id, value }); }}><textarea autoFocus aria-label={request.title} placeholder={request.method === 'input' ? request.placeholder : undefined} value={value} onChange={event => setValue(event.target.value)} /><div className="extension-actions"><button type="button" onClick={() => void submit({ id: request.id, cancelled: true })}>取消</button><button className="primary" type="submit">提交</button></div></form>}</fieldset></dialog>;
}

function CopyButton({ text, label }: { text: string; label: string }) { const [done, setDone] = useState(false); return <button className="copy-button" aria-label={label} onClick={() => void window.desktop.writeClipboard(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}>{done ? '已复制' : '复制'}</button>; }
function nodeText(node: unknown): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(nodeText).join(''); if (node && typeof node === 'object' && 'props' in node) return nodeText((node as { props?: { children?: unknown } }).props?.children); return ''; }
function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`; }
function activityLabel(activity: string): string { return activity === 'responding' ? 'Pi 正在处理' : activity === 'compacting' ? '正在压缩上下文' : activity === 'retrying' ? '正在重试' : activity === 'waiting-input' ? '等待你的选择' : 'Pi 已就绪'; }
function toolSummary(tool: ToolActivity): string { const args = tool.arguments; const value = (...keys: string[]) => keys.map(key => args[key]).find(item => typeof item === 'string') as string | undefined; if (tool.name === 'bash' || tool.name === 'powershell') return `运行 · ${value('command') || tool.name}`; if (tool.name === 'read') return `读取 · ${value('path') || ''}`; if (tool.name === 'write') return `写入 · ${value('path') || ''}`; if (tool.name === 'edit') return `编辑 · ${value('path') || ''}`; if (tool.name === 'grep') return `搜索 · ${value('pattern') || ''}`; if (tool.name === 'find') return `查找 · ${value('pattern') || ''}`; if (tool.name === 'ls') return `列出 · ${value('path') || '.'}`; return tool.name; }

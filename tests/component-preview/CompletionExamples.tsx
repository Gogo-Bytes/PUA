import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Breadcrumbs, Button, Dialog, DropdownMenu, Message, ToastHost, type MessageTone, type ToastItem } from '../../src/renderer/ui';
import { ChatMessage, Composer, type ComposerAttachment, type ComposerLabels, type ComposerSubmission } from '../../src/renderer/features/conversation';
/** Delays belong to preview adapters only; unmount settles and cancels every simulated operation. */
function usePreviewDelay() {
  const timers = useRef(new Map<ReturnType<typeof setTimeout>, (live: boolean) => void>());
  useEffect(() => () => { for (const [timer, resolve] of timers.current) { clearTimeout(timer); resolve(false); } timers.current.clear(); }, []);
  return (ms: number) => new Promise<boolean>(resolve => { const timer = setTimeout(() => { timers.current.delete(timer); resolve(true); }, ms); timers.current.set(timer, resolve); });
}
export const composerLabels: ComposerLabels = {
  message: '消息草稿', placeholder: '描述你想探索的任务…', hint: 'Enter 发送或排队 · Shift+Enter 换行', send: '发送', queue: '排队', stop: '停止',
  addAttachments: '添加示例附件', attachments: '草稿附件', removeAttachment: name => `移除 ${name}`, queued: count => `${count} 条排队中`, failed: '操作未完成，请重试。', error: '操作失败',
};
const chatLabels = { user: '用户', assistant: '助手', system: '系统', streaming: '正在回复…', failed: '回复失败' };
type Draft = { value: string; attachments: readonly ComposerAttachment[] };
type Entry = { draft: Draft; running: boolean; queued: number; sent: string[] };
const emptyEntry = (): Entry => ({ draft: { value: '', attachments: [] }, running: false, queued: 0, sent: [] });
export function ComposerPreview({ conversationKey, children }: { conversationKey: string; children?: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({}), [fail, setFail] = useState(false);
  const ids = useRef(0), delay = usePreviewDelay();
  const current = entries[conversationKey] ?? emptyEntry();
  const updateDraft = (change: (draft: Draft) => Draft) => setEntries(previous => {
    const entry = previous[conversationKey] ?? emptyEntry();
    return { ...previous, [conversationKey]: { ...entry, draft: change(entry.draft) } };
  });
  async function submit(submission: ComposerSubmission, queue: boolean) {
    const snapshot = current.draft;
    if (!await delay(650)) return;
    if (fail) throw new Error('示例拒绝：草稿和附件仍由调用方保留。');
    setEntries(previous => {
      const entry = previous[submission.conversationKey] ?? emptyEntry();
      return { ...previous, [submission.conversationKey]: { ...entry, running: queue ? entry.running : true, queued: entry.queued + (queue ? 1 : 0), sent: [...entry.sent, `${queue ? '已排队' : '已发送'}：${submission.value || '仅附件'}${submission.attachments.length ? `（${submission.attachments.length} 个附件）` : ''}`],
        // Caller policy: clear only the exact submitted draft, never a newer edit or another session.
        draft: entry.draft === snapshot ? { value: '', attachments: [] } : entry.draft } };
    });
  }
  return <div className="preview-composer-adapter">
    <div className="preview-transcript" tabIndex={0} role="region" aria-label="对话正文"><div className="preview-reading-column">{children}
    {current.sent.map((value, index) => <ChatMessage key={index} role="user" author="你" labels={chatLabels}>{value}</ChatMessage>)}
    {current.running && <ChatMessage role="assistant" author="小派" labels={chatLabels} streaming>演示运行状态：输入下一条内容可排队，也可以停止。没有连接模型。</ChatMessage>}
    </div></div>
    <div className="preview-composer-dock"><div className="preview-reading-column">
    <Composer conversationKey={conversationKey} value={current.draft.value} onValueChange={value => updateDraft(draft => ({ ...draft, value }))} attachments={current.draft.attachments}
      onAddAttachments={() => { const id = String(++ids.current); updateDraft(draft => ({ ...draft, attachments: [...draft.attachments, { id, name: `示例笔记-${id}.txt`, detail: '内存示例，不读取磁盘' }] })); }}
      onRemoveAttachment={id => updateDraft(draft => ({ ...draft, attachments: draft.attachments.filter(item => item.id !== id) }))}
      onSend={submission => submit(submission, false)} onQueue={submission => submit(submission, true)} busy={current.running} queuedCount={current.queued}
      onStop={async () => { if (!await delay(300)) return; setEntries(previous => { const entry = previous[conversationKey] ?? emptyEntry(); return { ...previous, [conversationKey]: { ...entry, running: false } }; }); }} labels={composerLabels}/>
    <details className="preview-test-controls"><summary>测试控制 · 发送</summary><div className="preview-row"><Button aria-pressed={fail} onClick={() => setFail(!fail)}>模拟发送失败：{fail ? '开' : '关'}</Button><span className="ui-meta">仅本地示例 · 650ms 回调 · 会话 {conversationKey}</span></div></details>
    </div></div>
  </div>;
}
export function NotificationsPreview() {
  const [items, setItems] = useState<ToastItem[]>([]), [mounted, setMounted] = useState(true), [inline, setInline] = useState(true), [details, setDetails] = useState(false);
  const id = useRef(0);
  const add = (tone: string) => setItems(previous => [...previous, { id: String(++id.current), tone: tone as MessageTone, toneLabel: ({ info: '提示', success: '成功', warning: '注意', error: '错误' })[tone], children: '这是本地通知，可悬停或聚焦暂停倒计时。', dismissLabel: '关闭通知', duration: 4000,
    action: { label: '查看详情', onClick: () => setDetails(true) } }]);
  return <div className="preview-completion-stack">
    <Breadcrumbs label="当前位置" items={[{ id: 'workspace', label: '工作台', onSelect: () => setDetails(true) }, { id: 'project', label: '组件预览', onSelect: () => setDetails(true) }, { id: 'current', label: '通知与导航' }]}/>
    {inline && <Message tone="info" toneLabel="提示" onDismiss={() => setInline(false)} dismissLabel="关闭行内提示" action={{ label: '位置详情', onClick: () => setDetails(true) }}>项目路径按需查看。</Message>}
    <Message tone="success" toneLabel="成功">组件已保存到本地示例。</Message><details className="preview-test-controls"><summary>状态目录 · 通知</summary><Message tone="warning" toneLabel="注意">尚未接入正式 App。</Message><Message tone="error" toneLabel="错误">示例错误：请检查后重试。</Message></details>
    <div className="preview-row"><DropdownMenu label="显示通知" items={[{ value: 'info', label: '提示通知' }, { value: 'success', label: '成功通知' }, { value: 'warning', label: '注意通知' }, { value: 'error', label: '错误通知' }]} onAction={add}/><details className="preview-test-controls"><summary>测试控制 · 通知</summary><Button onClick={() => setMounted(!mounted)}>{mounted ? '卸载通知层' : '挂载通知层'}</Button><Button onClick={() => setItems([])}>清空通知</Button></details></div>
    <details className="preview-stress"><summary>长内容与多层导航压力案例</summary><div className="preview-completion-stack">
      <Breadcrumbs label="多层导航" items={[{ id: 'home', label: '工作台', onSelect: () => setDetails(true) }, { id: 'team', label: '产品设计', onSelect: () => setDetails(true) }, { id: 'project', label: 'Atlas', href: '#atlas' }, { id: 'release', label: '九月发布', onSelect: () => setDetails(true) }, { id: 'review', label: '组件密度与键盘可访问性审阅', onSelect: () => setDetails(true) }, { id: 'current', label: '核对通知、会话与检查器在较窄窗口中的完整标题及交互目标' }]}/>
      <Message tone="error" toneLabel="保存失败" action={{ label: '重试', onClick: () => setDetails(true) }}><strong>无法保存本地示例。</strong><p>服务返回了详细错误：当前草稿与附件仍保留，请检查项目权限和目标位置后重试。错误详情不会因紧凑布局而被截断。</p><p>诊断标识：fixture-permission-denied-for-current-project-and-session。没有执行真实磁盘操作。</p></Message>
    </div></details>
    {mounted && <ToastHost items={items} label="通知" onDismiss={id => setItems(previous => previous.filter(item => item.id !== id))}/>}
    <Dialog open={details} title="位置详情" closeLabel="关闭详情" onClose={() => setDetails(false)}><p className="preview-path">/fixture/work/atlas/components/notifications</p><Button onClick={() => setDetails(false)}>返回预览</Button></Dialog>
  </div>;
}
export function DialogExamples() {
  const [mode, setMode] = useState<'confirm' | 'destructive' | 'async' | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), delay = usePreviewDelay();
  const close = () => { if (!lock.current) { setMode(null); setError(''); } };
  async function confirm() {
    if (lock.current) return;
    if (mode !== 'async') { close(); return; }
    lock.current = true; setPending(true); setError('');
    if (!await delay(650)) return;
    lock.current = false; setPending(false); setError('示例服务拒绝请求：内容未删除，可关闭后重试。');
  }
  return <><div className="preview-row"><Button onClick={() => setMode('confirm')}>确认示例</Button><Button variant="danger" onClick={() => setMode('destructive')}>危险操作示例</Button><Button onClick={() => setMode('async')}>异步失败示例</Button></div><Dialog open={mode !== null} title={mode === 'destructive' ? '删除示例条目？' : mode === 'async' ? '异步确认' : '确认此操作？'} closeLabel="关闭确认" onClose={close}>
    <p>{mode === 'destructive' ? '此操作不可撤销。这里只演示确认交互，不删除真实数据。' : '调用方决定提交、错误与关闭策略。'}</p>
    {error && <Message tone="error" toneLabel="提交失败" announcement="assertive">{error}</Message>}
    <div className="preview-row"><Button disabled={pending} onClick={close}>取消操作</Button><Button variant={mode === 'destructive' ? 'danger' : 'primary'} busy={pending} onClick={() => void confirm()}>{mode === 'destructive' ? '确认删除' : '确认操作'}</Button></div>
  </Dialog></>;
}
export function ChatExamples() {
  const [retried, setRetried] = useState(false);
  return <div className="preview-completion-stack"><ChatMessage role="user" author="你" labels={chatLabels}>切换会话时，怎样保留正在编辑的草稿？</ChatMessage><ChatMessage role="assistant" author="小派" labels={chatLabels}><p>让调用方按会话标识保存草稿，提交时捕获快照。请求完成后，只清理仍与快照一致的那份内容。</p><h2>检查重点</h2><ul><li>新输入不被旧请求覆盖。</li><li>失败后保留正文和附件。</li></ul></ChatMessage><details className="preview-test-controls"><summary>状态目录 · 安全文本、流式与失败</summary><ChatMessage role="system" author="工作台" metadata="本地示例" labels={chatLabels}>这是组件预览，不会调用 Pi。</ChatMessage><ChatMessage role="user" author="你" labels={chatLabels}>{'<img src=x onerror="alert(1)"> 作为文本显示，不执行 HTML。'}</ChatMessage><ChatMessage role="assistant" author="小派" metadata="刚刚" streaming labels={chatLabels}>正文可使用受控 React slot；流式内容不逐字播报。</ChatMessage><ChatMessage role="assistant" author="小派" error={retried ? undefined : "示例连接失败，未接真实服务。"} labels={chatLabels} actions={<Button onClick={() => setRetried(!retried)}>{retried ? '再次显示失败' : '重试示例'}</Button>}><p>已生成的正文保留。</p></ChatMessage></details></div>;
}

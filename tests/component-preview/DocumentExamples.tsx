import { Icon, Message, StatusBadge } from '../../src/renderer/ui';

/** Trusted local React content only. No HTML parsing, requests or production adapters. */
export function DocumentExamples() {
  return <>
    <h2>发布说明：会话草稿恢复</h2>
    <p>本次更新让<mark>未发送的输入始终跟随会话</mark>。阅读<a href="#document-glossary">术语说明</a>，或跳到<a href="#document-checklist">验收清单</a>。这段示例同时展示 <strong>重要结论</strong>、<em>补充语气</em>、<s>已废弃方案</s>与行内代码 <code>conversationKey</code>。</p>
    <Message tone="info">提示：使用 <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行，按 <kbd>Enter</kbd> 发送。</Message>
    <Message tone="warning">注意：切换会话后，旧请求仍可能完成；回写前需要核对提交版本。</Message>
    <h3 id="document-checklist">验收清单</h3>
    <ul className="ui-task-list">
      <li><Icon name="success"/><span>已完成：A / B 会话分别保存草稿。</span></li>
      <li><Icon name="success"/><span>已完成：请求失败后保留附件与原文。</span></li>
      <li><Icon name="clock" className="ui-task-pending"/><span>待检查：连续切换会话时的焦点恢复。</span></li>
    </ul>
    <h3>TypeScript · 提交快照</h3>
    <p>关联技能：<span className="ui-skill">$review</span> · 用于核对草稿回写规则。</p>
    <pre tabIndex={0} aria-label="带语法高亮的 TypeScript 示例"><code><span className="ui-code-comment">{'// 仅当版本一致时清空草稿\n'}</span><span className="ui-code-keyword">const</span>{' snapshot = {\n  conversationKey: '}<span className="ui-code-string">{'"release-plan"'}</span>{',\n  revision: '}<span className="ui-code-number">3</span>{',\n};\n'}<span className="ui-code-keyword">await</span>{' send(snapshot);\n'}<span className="ui-code-keyword">if</span>{' (draft.revision === snapshot.revision) {\n  clearDraft(snapshot.conversationKey);\n}'}</code></pre>
    <h3>变更对比</h3>
    <pre tabIndex={0} aria-label="草稿回写变更对比"><code><del>- clearCurrentDraft();</del><ins>+ clearDraftIfRevisionMatches(snapshot);</ins></code></pre>
    <h3>状态与结果</h3>
    <table tabIndex={0} aria-label="文档状态示例"><thead><tr><th>阶段</th><th>状态</th><th>说明</th></tr></thead><tbody>
      <tr><td>接口检查</td><td><StatusBadge status="success" label="通过"/></td><td>正文与附件快照完整</td></tr>
      <tr><td>浏览器验证</td><td><StatusBadge status="running" label="进行中"/></td><td>检查窄窗与键盘操作</td></tr>
      <tr><td>网络恢复</td><td><StatusBadge status="error" label="失败示例"/></td><td>保留草稿，允许重试</td></tr>
      <tr><td>生产接入</td><td><StatusBadge status="paused" label="待确认"/></td><td>当前仅本地预览</td></tr>
    </tbody></table>
    <blockquote><p>“完成请求”和“清空当前输入”是两个不同的动作。后者必须尊重用户在等待期间的新编辑。<sup><a href="#document-footnote" aria-label="查看脚注 1">[1]</a></sup></p></blockquote>
    <h3 id="document-glossary">术语说明</h3>
    <dl><dt>Snapshot · 快照</dt><dd>提交时捕获的一份正文、附件和版本信息。</dd><dt>Revision · 版本</dt><dd>每次编辑递增的标识，用于判断草稿是否仍与提交时一致。</dd></dl>
    <details><summary>展开边界案例与嵌套步骤</summary><ol><li>发起请求后继续编辑。<ul><li>成功：保留新草稿。</li><li>失败：展示错误，保留可重试内容。</li></ul></li><li>从 A 切换到 B，再返回 A；核对草稿、附件与焦点。</li></ol></details>
    <figure><pre tabIndex={0} aria-label="JSON 响应示例"><code>{'{\n  "status": "saved",\n  "conversationKey": "release-plan",\n  "revision": 3\n}'}</code></pre><figcaption>示例 1 · 本地响应结构，静态内容。</figcaption></figure>
    <hr/>
    <p id="document-footnote" className="ui-meta">[1] 这里的状态、代码和数据仅用于文档排版预览，不代表真实服务的运行结果。<a href="#document-checklist">返回清单 ↑</a></p>
  </>;
}

import { describe, expect, it } from 'vitest';
import { invokeChannels, sendChannels, eventChannels, type RequestMethod } from '../src/shared/ipc/channels';
import { requestParsers, validatePreferences } from '../src/shared/ipc/schemas';

import { preferences, create, samples } from './desktop-contract-fixtures';
const methods = Object.keys(samples) as RequestMethod[];

describe('desktop IPC contract', () => {
  it('retains exactly the declared invoke/send/event whitelist and unique channels', () => {
    const values = [...Object.values(invokeChannels), ...Object.values(sendChannels), ...Object.values(eventChannels)];
    expect(values).toHaveLength(63);
    expect(new Set(values).size).toBe(63);
    expect(Object.keys(invokeChannels)).toHaveLength(58);
    expect(Object.keys(sendChannels)).toEqual(['write', 'resize', 'acknowledge']);
    expect(Object.keys(eventChannels)).toEqual(['onSessionEvent', 'onBrowserViewState']);
    expect(values.map(value => value.replace('desktop:', '')).sort()).toEqual([
      'bootstrap', 'directory', 'file', 'attachments', 'chat-attachment-remove', 'chat-attachments', 'preferences', 'chat-model-catalog',
      'project-resources', 'create', 'start', 'close', 'archive-restore', 'archive-delete', 'session-pin', 'history-search', 'chat-send', 'chat-stop', 'extension-response', 'chat-rename', 'chat-models', 'chat-thinking-levels', 'chat-model-set', 'chat-thinking-set',
      'external', 'project', 'git-status', 'git-branches', 'git-branch-switch', 'git-branch-create', 'git-branch-delete', 'git-worktrees', 'git-worktree-create', 'git-worktree-delete', 'git-commit', 'git-push', 'file-diff', 'file-diff-contents', 'session-files', 'session-file-read', 'browser-create', 'browser-bounds', 'browser-navigate', 'browser-back', 'browser-forward', 'browser-reload', 'browser-dispose', 'browser-state', 'clipboard-read', 'clipboard-write', 'chat-fork', 'chat-clone', 'chat-session-stats', 'chat-auto-settings', 'chat-compact', 'chat-auto-compaction-set', 'chat-auto-retry-set', 'chat-steering-mode-set', 'chat-follow-up-mode-set', 'write', 'resize', 'ack', 'event',
    ].sort());
    expect(Object.keys(requestParsers).sort()).toEqual(methods.sort());
  });
  it.each(methods)('%s accepts its tuple and rejects malformed/missing/extra parameters', method => {
    expect(() => requestParsers[method](samples[method])).not.toThrow();
    expect(() => requestParsers[method]([...samples[method], 'extra'])).toThrow('参数数量');
    if (samples[method].length) {
      expect(() => requestParsers[method]([])).toThrow('参数数量');
      expect(() => requestParsers[method]([null, ...samples[method].slice(1)])).toThrow();
    }
  });
  it('validates every string id/path and preserves relative/home paths and uncapped clipboard/PTY data', () => {
    for (const method of methods.filter(method => typeof samples[method][0] === 'string')) {
      expect(() => requestParsers[method](['bad\0id', ...samples[method].slice(1)])).toThrow();
      expect(() => requestParsers[method]([42, ...samples[method].slice(1)])).toThrow();
    }
    expect(requestParsers.createSession([create])[0].cwd).toBe('~/project');
    expect(requestParsers.inspectProjectResources(['../relative'])).toEqual(['../relative']);
    const paste = 'x'.repeat(8 * 1024 * 1024 + 1);
    expect(requestParsers.writeClipboard([paste])[0]).toBe(paste);
    expect(requestParsers.write(['id', paste + '\0'])[1]).toBe(paste + '\0');
    expect(() => requestParsers.write(['id', 4])).toThrow();
  });
  it('preserves chat defaults, deliveries and all existing size limits, rebuilding the input whitelist', () => {
    const input = { attachmentIds: [], delivery: 'prompt', path: '/private', command: { type: 'raw-pi' } };
    expect(requestParsers.sendChatMessage(['id', input])).toEqual(['id', { text: '', attachmentIds: [], delivery: 'prompt' }]);
    for (const delivery of ['prompt', 'steer', 'followUp']) {
      expect(requestParsers.sendChatMessage(['id', { text: 'x'.repeat(8 * 1024 * 1024), attachmentIds: Array(20).fill('x'.repeat(128)), delivery }])[1].delivery).toBe(delivery);
    }
    const valid = { text: '', attachmentIds: [], delivery: 'prompt' };
    for (const patch of [{ text: 'x'.repeat(8 * 1024 * 1024 + 1) }, { text: '\0' }, { text: 2 }, { attachmentIds: Array(21).fill('id') }, { attachmentIds: ['x'.repeat(129)] }, { attachmentIds: [4] }, { attachmentIds: null }, { attachmentIds: new Array(1) }, { delivery: 'raw-command' }]) {
      expect(() => requestParsers.sendChatMessage(['id', { ...valid, ...patch }])).toThrow();
    }
    for (const input of [null, false, [], {}]) expect(() => requestParsers.sendChatMessage(['id', input])).toThrow();
    expect(requestParsers.removeChatAttachment(['id', 'x'.repeat(128)])[1]).toHaveLength(128);
    expect(() => requestParsers.removeChatAttachment(['id', 'x'.repeat(129)])).toThrow('附件 id过长');
    expect(requestParsers.renameChatSession(['id', 'x'.repeat(200)])[1]).toHaveLength(200);
    expect(() => requestParsers.renameChatSession(['id', 'x'.repeat(201)])).toThrow('会话名称过长');
  });
  it('reuses the extension union whitelist and limits without forwarding raw fields', () => {
    for (const result of [{ value: '' }, { confirmed: false }, { cancelled: true }]) {
      expect(requestParsers.respondToExtensionUI(['id', { id: 'request', ...result, path: '/private', type: 'raw' }])[1]).toEqual({ id: 'request', ...result });
    }
    expect(requestParsers.respondToExtensionUI(['id', { id: 'x'.repeat(256), value: 'x'.repeat(1024 * 1024) }])[1]).toHaveProperty('value');
    for (const response of [null, {}, { id: '', value: '' }, { id: 'x'.repeat(257), value: '' }, { id: 'x', value: 'x'.repeat(1024 * 1024 + 1) }, { id: 'x', value: '', confirmed: true }, { id: 'x', cancelled: false }]) {
      expect(() => requestParsers.respondToExtensionUI(['id', response])).toThrow();
    }
  });
  it('validates create enums and dimensions without taking session policy or filesystem ownership', () => {
    for (const kind of ['chat', 'terminal']) for (const startMode of ['new', 'continue', 'resume']) for (const projectTrust of ['default', 'approve', 'decline']) {
      expect(() => requestParsers.createSession([{ ...create, kind, startMode, projectTrust, cols: 2, rows: 1000 }])).not.toThrow();
    }
    for (const patch of [{ cwd: null }, { kind: 'raw' }, { startMode: 'fork' }, { projectTrust: 'yes' }, { kind: 'terminal' }, { cols: '100' }, { rows: Infinity }]) {
      expect(() => requestParsers.createSession([{ ...create, ...patch }])).toThrow();
    }
    const initial = { ...create, initialModel: { provider: 'openai-codex', id: 'gpt-5.5' }, initialThinkingLevel: 'high' };
    expect(requestParsers.createSession([initial])[0]).toMatchObject({ initialModel: initial.initialModel, initialThinkingLevel: 'high' });
    for (const patch of [{ initialThinkingLevel: 'secret' }, { initialModel: { provider: '--bad', id: 'model' } }, { initialModel: { provider: 'openai', id: '--flag' } }, { kind: 'terminal', initialThinkingLevel: 'high' }, { startMode: 'continue', initialModel: { provider: 'openai', id: 'model' } }]) {
      expect(() => requestParsers.createSession([{ ...create, ...patch }])).toThrow();
    }
    expect(requestParsers.createSession([{ ...create, arbitrary: 'raw-command' }])[0]).not.toHaveProperty('arbitrary');
    for (const cols of [2, 1000]) for (const rows of [2, 1000]) expect(requestParsers.resize(['id', cols, rows])).toEqual(['id', cols, rows]);
    for (const size of [1, 1001, 2.5, NaN, Infinity, '2', null]) {
      expect(() => requestParsers.resize(['id', size, 30])).toThrow();
      expect(() => requestParsers.resize(['id', 100, size])).toThrow();
      expect(() => requestParsers.createSession([{ ...create, kind: 'terminal', cols: size, rows: 30 }])).toThrow();
    }
    for (const size of [1, Number.MAX_SAFE_INTEGER]) expect(requestParsers.acknowledge(['id', size])).toEqual(['id', size]);
    for (const size of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1']) expect(() => requestParsers.acknowledge(['id', size])).toThrow();
  });
  it('retains preference normalization, enum checks and bounds without new CLI length limits', () => {
    expect(validatePreferences(preferences).theme).toBe('system');
    expect(validatePreferences({ ...preferences, recentProjects: Array(30).fill('same') }).recentProjects).toEqual(['same']);
    for (const fontSize of [10, 28]) expect(validatePreferences({ ...preferences, fontSize }).fontSize).toBe(fontSize);
    for (const patch of [{ piPath: '\0' }, { nodePath: 3 }, { args: ['\0'] }, { args: [3] }, { args: new Array(1) }, { recentProjects: [3] }, { recentProjects: new Array(1) }, { fontSize: 9 }, { fontSize: 29 }, { fontSize: NaN }, { theme: 'auto' }]) {
      expect(() => requestParsers.savePreferences([{ ...preferences, ...patch }])).toThrow();
    }
    expect(validatePreferences({ ...preferences, args: ['x'.repeat(1024 * 1024)] }).args[0]).toHaveLength(1024 * 1024);
  });
  it('normalizes HTTP(S), rejects other protocols, and constrains diff scope but not Git membership', () => {
    expect(requestParsers.openExternal(['HTTP://EXAMPLE.COM'])).toEqual(['http://example.com/']);
    for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'data:text/plain,test', 'not a url', '\0']) expect(() => requestParsers.openExternal([url])).toThrow();
    for (const scope of ['worktree', 'index']) expect(requestParsers.fileDiff(['id', '../not-membership-validated-here', scope])[2]).toBe(scope);
    for (const scope of ['all', null, 1]) expect(() => requestParsers.fileDiff(['id', 'file', scope])).toThrow('未知 diff 范围');
    expect(() => requestParsers.fileDiff(['id', 'file\0', 'index'])).toThrow('无效字符串');
  });
});

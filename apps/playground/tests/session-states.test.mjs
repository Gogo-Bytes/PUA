import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UIProvider, SessionRow } from '@pua/components';
import { resolveSessionPresentation as resolve, normalizeProgress, toSidebarSession } from '../src/study-presentation.ts';
import { stateCases, stateGroups } from '../src/state-cases.ts';

test('study source errors, identities and float variants map into the formal right-only slot', () => {
  for (const signal of [{ runtime: 'systemError' }, { environment: 'remote' }, { identity: 'aeon' }, { runtime: 'active', floatStatus: true }]) {
    const display = resolve(signal);
    assert.deepEqual(display.leading, []);
    const html = renderToStaticMarkup(React.createElement(UIProvider, {}, React.createElement(SessionRow, { session: { id: 'regression', title: 'Session', ...toSidebarSession({ id: 'regression', title: 'Session', presentation: signal }) }, onSelect() {} })));
    const label = html.match(/class="pua-row-label"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    assert.ok(label && !label.includes('data-badge='), 'title must not contain status/identity icons');
    assert.match(html, /class="pua-session-meta"[\s\S]*data-badge=/);
  }
});

test('sessions have boolean unread, never a numeric unread badge', () => {
  assert.equal(resolve({ unreadCount: 126 }).trailing, null, 'legacy generic count must not create session unread');
  assert.equal(resolve({}, { unread: true }).trailing.kind, 'unread');
  for (const item of stateCases) assert.ok(!Object.hasOwn(item.session.presentation, 'unreadCount'), item.id);
});

test('study d9n base priority and Cloud override', () => {
  const cases = [
    [{}, 'idle'], [{ ownedWork: true }, 'loading'], [{ runtime: 'systemError' }, 'error'], [{ runtime: 'active' }, 'loading'], [{ needsResume: true }, 'idle'], [{ latestTurnError: true }, 'error'], [{ responseInProgress: true }, 'loading'],
    [{ ownedWork: true, runtime: 'systemError' }, 'loading'], [{ runtime: 'active', needsResume: true, latestTurnError: true }, 'loading'], [{ needsResume: true, latestTurnError: true }, 'idle'], [{ latestTurnError: true, responseInProgress: true }, 'error'], [{ runtime: 'systemError', publishing: true }, 'loading'],
  ];
  for (const [signal, activity] of cases) assert.equal(resolve(signal).activity, activity, JSON.stringify(signal));
  const frozen = Object.freeze({ ownedWork: true });
  resolve(frozen); assert.deepEqual(frozen, { ownedWork: true });
});

test('entry mappings preserve other buckets without inventing success/draft', () => {
  for (const status of ['failed', 'outcome-unknown', 'other']) assert.equal(resolve({ entry: { kind: 'pending-start', status } }).activity, status === 'other' ? 'loading' : 'error');
  for (const phase of ['queued', 'creating', 'setting-up', 'failed', 'worktree-ready']) {
    const display = resolve({ entry: { kind: 'worktree-start', phase } });
    assert.equal(display.activity, phase === 'failed' ? 'error' : phase === 'worktree-ready' ? 'idle' : 'loading');
    if (phase === 'failed') assert.equal(display.badges.find(badge => badge.kind === 'error').label, 'Worktree init failed');
    if (display.activity === 'loading') assert.equal(display.badges.find(badge => badge.kind === 'environment').pulsing, true);
  }
  for (const latestTurn of ['in_progress', 'pending', 'failed', 'other']) assert.equal(resolve({ entry: { kind: 'remote-task', latestTurn } }).activity, latestTurn === 'failed' ? 'error' : latestTurn === 'other' ? 'idle' : 'loading');
});

test('boolean unread, Working and Pin are independent and correctly ordered', () => {
  assert.equal(resolve({}, { unread: true }).trailing.kind, 'unread');
  assert.equal(resolve({ runtime: 'active' }, { unread: true }).trailing.kind, 'working');
  const errorUnread = resolve({ runtime: 'systemError' }, { unread: true });
  assert.equal(errorUnread.badges[0].kind, 'error'); assert.equal(errorUnread.trailing.kind, 'unread');
  assert.equal(resolve({}, { pinned: true }).badges[0].kind, 'pin');
  assert.equal(resolve({}, { pinned: true, unread: true }).badges.length, 0);
  assert.equal(resolve({ suppressChildUnread: true }, { unread: true }).trailing, null);
});

test('attention, active and indicator-only gates, including publishing', () => {
  const blocking = { runtime: 'active', attention: { kind: 'input', blocking: true } };
  assert.equal(resolve(blocking).activity, 'idle'); assert.equal(resolve(blocking).trailing.kind, 'input');
  assert.equal(resolve({ ...blocking, active: true }).trailing, null);
  assert.equal(resolve({ ...blocking, hideStatusIndicator: true }).trailing.kind, 'input');
  const only = resolve({ ...blocking, attentionIndicatorOnly: true });
  assert.equal(only.activity, 'idle'); assert.equal(only.trailing.kind, 'unread');
  assert.equal(resolve({ ...blocking, attentionIndicatorOnly: true, suppressChildUnread: true }).trailing, null);
  assert.equal(resolve({ ...blocking, publishing: true }).activity, 'loading');
  assert.equal(resolve({ ...blocking, publishing: true }).trailing.kind, 'input');
  const async = { runtime: 'active', attention: { kind: 'input', source: 'userInputAsync' } };
  assert.deepEqual(resolve(async).chips, ['Needs input']); assert.equal(resolve(async).trailing.kind, 'working');
  assert.deepEqual(resolve({ ...async, active: true }).chips, []);
  assert.deepEqual(resolve({ ...async, childApproval: true }).chips, ['Awaiting approval']);
});

test('override/leading priority/hide/float gates are not runtime states', () => {
  const display = resolve({ runtime: 'systemError', priorityIndicator: 'Priority', realtimeVoice: true });
  assert.equal(display.activity, 'error'); assert.equal(display.badges[0].kind, 'priority'); assert.equal(display.trailing.kind, 'voice-active');
  assert.equal(resolve({ runtime: 'active', hideStatusIndicator: true }).trailing, null);
  assert.equal(resolve({ hideStatusIndicator: true, indicatorOverride: 'Override' }).trailing.kind, 'custom');
  assert.equal(resolve({ indicatorOverride: 'Override', realtimeVoice: true }).trailing.kind, 'voice-active');
  assert.equal(resolve({ runtime: 'systemError', archiveConfirmation: true }).badges.length, 0);
  assert.equal(resolve({ runtime: 'systemError', statusIndicatorReplacesMeta: true }).badges.length, 0);
  assert.equal(resolve({ runtime: 'active', floatStatus: true }).floatStatus, false);
  assert.equal(resolve({ remoteUnavailable: true }).hideQuickActions, true);
  assert.equal(resolve({ remoteUnavailable: true }).disabled, true);
  assert.equal(resolve({ archived: true }).visible, false);
  assert.equal(resolve({ automation: 'attached' }).confirmArchive, true);
});

test('caller-normalized environment and attention prerequisites do not invent backend decoding', () => {
  for (const environment of ['cloud', 'remote', 'remote-worktree']) {
    const display = resolve({ environment, environmentVisible: false, runtime: 'active' });
    assert.ok(!display.badges.some(badge => badge.kind === 'environment'));
    assert.equal(display.visible, true); assert.equal(display.trailing.kind, 'working');
  }
  for (const id of ['state:missing-requests', 'state:resume-not-waiting']) {
    const sample = stateCases.find(item => item.id === id);
    assert.equal(sample.session.presentation.attention, undefined);
    const display = resolve(sample.session.presentation);
    assert.deepEqual(display.chips, []); assert.equal(display.trailing, null);
  }
});

test('subscription diagnostics opt in and use independent classifier priority', () => {
  const subscription = signal => resolve({ subscription: { enabled: true, ...signal } }).badges[0];
  assert.deepEqual(subscription({ streamRole: 'leader', runtimeActive: true }), { kind: 'diagnostic', label: 'Subscribed: active', tone: 'green' });
  assert.equal(subscription({ streamRole: 'follower', runtimeActive: true }).tone, 'purple');
  assert.equal(subscription({ streamRole: 'leader' }).tone, 'yellow');
  assert.equal(subscription({ needsResume: true }).tone, 'danger');
  assert.equal(subscription({ runtimeActive: true }).tone, 'orange');
  assert.equal(resolve({ subscription: { enabled: false, streamRole: 'leader', runtimeActive: true } }).badges.length, 0);
});

test('study malformed progress normalization is deterministic', () => {
  assert.equal(normalizeProgress(-2), 0); assert.equal(normalizeProgress(4), 1); assert.equal(normalizeProgress(.45), .45);
  for (const value of [NaN, Infinity, undefined, '4']) assert.equal(normalizeProgress(value), 0);
});

test('every named fixture renders via the public SessionRow; no time/arrows or fake badges', () => {
  assert.equal(stateCases.length, 86);
  assert.equal(new Set(stateCases.map(item => item.id)).size, stateCases.length);
  for (const group of stateGroups) assert.ok(stateCases.some(item => item.group === group.id), group.id);
  for (const item of stateCases) {
    const display = resolve(item.session.presentation, item.session);
    assert.equal(new Set(display.labels).size, display.labels.length, item.id);
    const mapped = toSidebarSession(item.session);
    if (mapped) {
      const mappedHTML = renderToStaticMarkup(React.createElement(UIProvider, {}, React.createElement(SessionRow, { session: mapped, onSelect() {} })));
      for (const label of display.labels) assert.ok(mappedHTML.includes(label.replaceAll('&', '&amp;').replaceAll('\"', '&quot;')), `${item.id}: lost semantic label ${label}`);
    }
    const html = renderToStaticMarkup(React.createElement(UIProvider, {}, React.createElement(SessionRow, { session: toSidebarSession(item.session) ?? { id: item.id, title: item.title }, onSelect() {}, onPin() {}, onPrimaryAction() {}, onMenuAction() {}, onSnooze() {} })));
    assert.ok(!html.includes('<time'), item.id); assert.ok(!html.includes('pua-disclosure-icon'), item.id);
    if (!display.visible) assert.equal(toSidebarSession(item.session), null, item.id);
    assert.ok(!display.labels.some(label => /^(Completed|Success|Draft)$/.test(label)), item.id);
  }
});

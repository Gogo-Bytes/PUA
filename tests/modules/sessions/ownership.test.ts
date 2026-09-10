import { describe, expect, it } from 'vitest';
import { SessionOwnershipPolicy, type SessionSnapshot, type SessionIntent, type SessionLifecycle } from '../../../src/modules/sessions/index';

const intents: SessionIntent[] = [
  { kind: 'chat', startMode: 'new' }, { kind: 'chat', startMode: 'continue' }, { kind: 'chat', startMode: 'resume' },
  { kind: 'terminal', startMode: 'new' }, { kind: 'terminal', startMode: 'continue' }, { kind: 'terminal', startMode: 'resume' },
];
function slot(intent: SessionIntent, lifecycle: SessionLifecycle): SessionSnapshot { return { id: 'owner', cwd: '/other-project', title: 'owner', ...intent, lifecycle }; }
describe('SessionOwnershipPolicy', () => {
  it.each(intents)('checks empty ownership and unsupported intent: %j', intent => {
    const result = SessionOwnershipPolicy.reserve(intent, [], false);
    expect(result.ok).toBe(!(intent.kind === 'chat' && intent.startMode === 'resume'));
    expect(SessionOwnershipPolicy.reserve(intent, [], true)).toEqual({ ok: false, code: 'SHUTTING_DOWN' });
  });
  for (const owner of intents.filter(intent => !(intent.kind === 'chat' && intent.startMode === 'resume'))) {
    for (const lifecycle of [{ phase: 'reserved' }, { phase: 'starting' }, { phase: 'running' }, { phase: 'closing', previous: 'starting' }, { phase: 'closing', previous: 'running' }, { phase: 'cleanup-failed', previous: 'starting' }, { phase: 'cleanup-failed', previous: 'running' }] satisfies SessionLifecycle[]) {
      it.each(intents)(`owner ${owner.kind}/${owner.startMode} ${JSON.stringify(lifecycle)} vs %j (global, including closing)`, intent => {
        const result = SessionOwnershipPolicy.reserve(intent, [slot(owner, lifecycle)], false);
        const ready = lifecycle.phase === 'running' || ('previous' in lifecycle && lifecycle.previous === 'running');
        const allowed = intent.kind === 'chat' && intent.startMode === 'new' && owner.kind === 'chat' && (owner.startMode === 'new' || ready);
        expect(result.ok).toBe(allowed);
        if (!result.ok) expect(result.code).toBe(intent.kind === 'chat' && intent.startMode === 'resume' ? 'CHAT_RESUME_UNSUPPORTED' : intent.kind === 'terminal' || owner.kind === 'terminal' ? 'TERMINAL_EXCLUSIVE' : 'RESTORE_CONFLICT');
      });
    }
  }
  it('releases only exited slots', () => {
    for (const intent of intents) expect(SessionOwnershipPolicy.reserve(intent, [slot({ kind: 'terminal', startMode: 'resume' }, { phase: 'exited', exitCode: 1 })], false)).toEqual(SessionOwnershipPolicy.intent(intent));
  });
});

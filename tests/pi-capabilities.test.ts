import { describe, expect, it } from 'vitest';
import { piCapabilities } from '../src/shared/ipc/pi-capabilities';

describe('Pi capability registry', () => {
  it('keeps capability ids unique and actionable', () => {
    const ids = piCapabilities.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of piCapabilities) {
      expect(item.rpcCommands.length, item.id).toBeGreaterThan(0);
      expect(item.rpcCommands.every(command => command.length > 0), item.id).toBe(true);
    }
  });

  it('records the implemented Pi paths as integrated and leaves unresolved paths explicit', () => {
    for (const id of ['conversation.stream', 'conversation.queue', 'conversation.compact', 'conversation.retry', 'conversation.stats', 'session.fork', 'session.tree', 'session.clone', 'session.rename', 'model.list', 'model.select', 'thinking.select', 'resources.skills', 'resources.promptTemplates', 'extensions.ui'] as const) {
      expect(piCapabilities.find(item => item.id === id)?.status, id).toBe('integrated');
    }
    for (const id of ['conversation.retryAbort', 'session.entries'] as const) {
      expect(piCapabilities.find(item => item.id === id)?.status, id).toBe('protocol-ready');
    }
    expect(piCapabilities.find(item => item.id === 'session.switch')?.status).toBe('needs-runtime-verification');
    expect(piCapabilities.find(item => item.id === 'session.bash')?.status).toBe('product-discussion');
    expect(piCapabilities.find(item => item.id === 'session.export')?.status).toBe('product-discussion');
  });
});

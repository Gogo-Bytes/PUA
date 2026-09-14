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

  it('does not claim unsupported capabilities are integrated', () => {
    for (const item of piCapabilities) {
      if (item.status === 'integrated') expect(item.id).not.toBe('session.fork');
    }
  });
});

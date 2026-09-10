import type { PreferenceValues, PreferencesPersistencePort } from '../ports.js';

/** Owns current desktop preferences and recently created projects, not Pi configuration. */
export class PreferencesApplication {
  constructor(private current: PreferenceValues, private readonly persistence: PreferencesPersistencePort) {}

  // Preserve existing in-process references; this is not an immutable snapshot Interface.
  read(): PreferenceValues { return this.current; }

  async save<R>(next: PreferenceValues, afterPublished: () => R): Promise<R> {
    next.recentProjects = this.current.recentProjects;
    await this.persistence.write(next);
    this.current = next;
    // Bootstrap must observe publication in this continuation, without another await.
    return afterPublished();
  }

  async recordRecent(cwd: string, onWriteFailure: (error: unknown) => Promise<never>): Promise<void> {
    const next = { ...this.current, recentProjects: [cwd, ...this.current.recentProjects.filter(p => p !== cwd)].slice(0, 20) };
    try { await this.persistence.write(next); this.current = next; }
    catch (error) {
      // Begin the caller's resource compensation in the original write-failure continuation.
      await onWriteFailure(error);
    }
  }
}

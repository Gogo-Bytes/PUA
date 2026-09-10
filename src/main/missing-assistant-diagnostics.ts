import { createMissingAssistantDiagnostics, diagnosticId } from '../shared/missing-assistant-diagnostics.js';

const optInKey = 'PUA_MISSING_ASSISTANT_DIAGNOSTICS';
const targetKey = 'PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION';

/** Remove diagnostic controls before starting Pi or any non-target utility. */
export function withoutMissingAssistantDiagnostics<T extends Record<string, string | undefined>>(env: T): T {
  const result = { ...env };
  delete result[optInKey]; delete result[targetKey];
  return result;
}

/** A next-chat opt-in binds once at registration, even if that chat later fails. */
export class MissingAssistantDiagnosticSession {
  private bound = false;
  private target?: string;
  readonly output;
  constructor(private readonly mode: string | undefined, sink: (line: string) => void) {
    this.output = createMissingAssistantDiagnostics(() => this.target, sink);
  }
  register(id: string, kind: 'chat' | 'terminal'): void {
    if (this.mode !== 'next-chat' || this.bound || kind !== 'chat') return;
    this.bound = true; this.target = diagnosticId(id);
  }
  workerEnvironment(env: Record<string, string | undefined>, id: string): Record<string, string | undefined> {
    const result = withoutMissingAssistantDiagnostics(env);
    if (this.target && id === this.target) result[targetKey] = this.target;
    return result;
  }
}

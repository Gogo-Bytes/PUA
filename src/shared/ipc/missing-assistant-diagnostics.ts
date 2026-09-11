/** Temporary opt-in P0 metadata only. Never serializes messages, errors, tools or environment. */
export const missingAssistantDiagnosticPrefix = '[PUA_ASSISTANT_DIAGNOSTIC] ';
export type MissingAssistantStage = 'worker-received' | 'worker-emitted' | 'main-accepted' | 'main-forwarded' | 'renderer-received' | 'renderer-reduced';
const stages: readonly string[] = ['worker-received', 'worker-emitted', 'main-accepted', 'main-forwarded', 'renderer-received', 'renderer-reduced'];
const eventTypes = new Set(['message_start', 'message_update', 'message_end', 'agent_start', 'agent_end', 'agent_settled', 'chat-message-start', 'chat-message-delta', 'chat-message-end', 'chat-state', 'chat-snapshot', 'session-info', 'chat-projection', 'exit', 'tool_execution_start', 'tool_execution_update', 'tool_execution_end', 'chat-tool']);
const blockTypes = new Set(['text', 'thinking', 'image', 'toolCall', 'tool']);
const roles = new Set(['assistant', 'user', 'toolResult', 'custom', 'summary']);
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export const diagnosticId = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
interface Entry {
  stage: MissingAssistantStage;
  sessionId: string;
  eventType: string;
  messageId?: string;
  role?: string;
  blockTypes: string[];
  marker: boolean;
}
const marker = (value: unknown): boolean => typeof value === 'string' && value.includes('PUA_ACCEPTANCE_OK');

/** One fixed quota per process/renderer instance, including worker stdout relays.
 * Target lookup, projection and sink failures are isolated from the business path.
 */
export function createMissingAssistantDiagnostics(target: () => string | undefined, sink: (line: string) => void) {
  let count = 0;
  let pending = '';
  const emit = (entry: Entry) => {
    if (count >= 100 || entry.sessionId !== diagnosticId(target())) return;
    count++;
    sink(missingAssistantDiagnosticPrefix + JSON.stringify(entry));
  };
  return {
    enabled(sessionId: string): boolean {
      try { return count < 100 && sessionId === diagnosticId(target()); } catch { return false; }
    },
    record(stage: MissingAssistantStage, sessionId: string, value: unknown): void {
      try {
        if (count >= 100 || sessionId !== diagnosticId(target())) return;
        const event = record(value);
        if (!event || typeof event.type !== 'string' || !eventTypes.has(event.type)) return;
        const message = record(event.message);
        const blocks = message?.content ?? message?.blocks;
        const content = Array.isArray(blocks) ? blocks.slice(0, 4096).map(record) : [];
        const update = record(event.assistantMessageEvent);
        emit({ stage, sessionId, eventType: event.type,
          messageId: diagnosticId(message?.id ?? event.messageId),
          role: typeof message?.role === 'string' && roles.has(message.role) ? message.role : undefined,
          blockTypes: [...new Set(content.flatMap(block => typeof block?.type === 'string' && blockTypes.has(block.type) ? [block.type] : []))],
          marker: marker(event.delta) || marker(update?.delta) || content.some(block => marker(block?.text) || marker(block?.thinking)),
        });
      } catch { /* Diagnostics must not affect delivery or cleanup. */ }
    },
    /** Target utility stdout only. Bounded framing + strict reconstruction, never echo raw output. */
    relay(sessionId: string, chunk: string): void {
      try {
        if (count >= 100 || sessionId !== diagnosticId(target())) return;
        // Oversized/non-diagnostic stdout is discarded, not retained or reported.
        if (pending.length + chunk.length > 16_384) { pending = ''; return; }
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          if (!line.startsWith(missingAssistantDiagnosticPrefix)) continue;
          let raw: Record<string, unknown> | undefined;
          try { raw = record(JSON.parse(line.slice(missingAssistantDiagnosticPrefix.length))); } catch { continue; }
          if (!raw || (raw.stage !== 'worker-received' && raw.stage !== 'worker-emitted') || !stages.includes(raw.stage) ||
              raw.sessionId !== diagnosticId(target()) || typeof raw.eventType !== 'string' || !eventTypes.has(raw.eventType) ||
              typeof raw.marker !== 'boolean' || !Array.isArray(raw.blockTypes)) continue;
          emit({ stage: raw.stage, sessionId: raw.sessionId as string, eventType: raw.eventType,
            messageId: diagnosticId(raw.messageId), role: typeof raw.role === 'string' && roles.has(raw.role) ? raw.role : undefined,
            blockTypes: [...new Set(raw.blockTypes.filter((type): type is string => typeof type === 'string' && blockTypes.has(type)))], marker: raw.marker,
          });
        }
      } catch { pending = ''; }
    },
  };
}

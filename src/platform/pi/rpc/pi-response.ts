import { isRecord } from './chat-normalize.js';

// Pi-only spellings and consumed payloads; never part of the utility/Desktop wire.
export type PiCommand =
  | { type: 'get_state' | 'get_messages' | 'get_commands' | 'get_tree' | 'get_fork_messages' | 'get_session_stats' | 'get_available_models' | 'get_available_thinking_levels' | 'clear_queue' | 'abort' }
  | { type: 'fork'; entryId: string }
  | { type: 'clone' }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: string }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'abort_retry' }
  | { type: 'set_steering_mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'set_follow_up_mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'export_html'; outputPath: string }
  | { type: 'set_session_name'; name: string }
  | { type: 'prompt'; message: string; images: Array<{ type: 'image'; data: string; mimeType: string }>; streamingBehavior: 'steer' | 'followUp' };

export interface PiResponseData {
  get_available_thinking_levels: { levels: string[] };
  get_state: Record<string, unknown>;
  get_available_models: { models: PiModel[] };
  get_messages: { messages: unknown[] };
  get_commands: { commands: unknown[] };
  get_tree: Record<string, unknown>;
  get_fork_messages: Record<string, unknown>;
  get_session_stats: Record<string, unknown>;
  clear_queue: { steering: string[]; followUp: string[] };
  // These commands consume only the ACK; extra data is deliberately not constrained.
  prompt: unknown;
  abort: unknown;
  set_session_name: unknown;
  fork: { text: string; cancelled: boolean }; clone: { cancelled: boolean }; switch_session: { cancelled: boolean }; set_model: unknown; set_thinking_level: unknown; set_auto_compaction: unknown; set_auto_retry: unknown; abort_retry: unknown; set_steering_mode: unknown; set_follow_up_mode: unknown; compact: unknown; export_html: { path: string };
}
export interface PiModel { provider: string; id: string; name?: string; reasoning?: boolean }

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && Array.from(value).every(item => typeof item === 'string');
}
function models(value: unknown): value is PiModel[] {
  return Array.isArray(value) && value.every(item => isRecord(item) && typeof item.provider === 'string' && item.provider.length > 0 && typeof item.id === 'string' && item.id.length > 0 && (item.name === undefined || typeof item.name === 'string') && (item.reasoning === undefined || typeof item.reasoning === 'boolean'));
}

function validData<C extends PiCommand['type']>(command: C, data: unknown): data is PiResponseData[C] {
  switch (command) {
    case 'get_available_thinking_levels': return isRecord(data) && Array.isArray(data.levels) && data.levels.every(value => typeof value === 'string');
    case 'get_state': return isRecord(data);
    case 'get_available_models': return isRecord(data) && models(data.models);
    case 'get_messages': return isRecord(data) && Array.isArray(data.messages);
    case 'get_commands': return isRecord(data) && Array.isArray(data.commands);
    case 'get_tree': case 'get_fork_messages': case 'get_session_stats': return isRecord(data);
    case 'clear_queue': return isRecord(data) && stringArray(data.steering) && stringArray(data.followUp);
    case 'fork': return isRecord(data) && typeof data.text === 'string' && typeof data.cancelled === 'boolean';
    case 'clone': return isRecord(data) && typeof data.cancelled === 'boolean';
    case 'switch_session': return isRecord(data) && typeof data.cancelled === 'boolean';
    case 'export_html': return isRecord(data) && typeof data.path === 'string';
    case 'prompt': case 'abort': case 'set_session_name': case 'set_model': case 'set_thinking_level': case 'set_auto_compaction': case 'set_auto_retry': case 'abort_retry': case 'set_steering_mode': case 'set_follow_up_mode': case 'compact': return true;
  }
}

/** Caller correlates by pending ID first. A protocol failure does not prove non-acceptance. */
export function parsePiResponse<C extends PiCommand['type']>(command: C, value: Record<string, unknown>): PiResponseData[C] {
  const protocolError = () => new Error(`Pi RPC protocol error (${command}); acceptance unknown${command === 'clear_queue' ? '; recovery unknown' : ''}`);
  if (value.type !== 'response' || value.command !== command || typeof value.success !== 'boolean') throw protocolError();
  if (!value.success) {
    if (typeof value.error !== 'string') throw protocolError();
    throw new Error(value.error);
  }
  if (!validData(command, value.data)) throw protocolError();
  return value.data;
}

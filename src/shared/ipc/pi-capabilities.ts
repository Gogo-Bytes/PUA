/** Capability inventory for the installed Pi RPC surface. Keep this explicit: it is not an arbitrary command escape hatch. */
export type PiCapabilityId =
  | 'conversation.stream' | 'conversation.queue' | 'conversation.queueModes' | 'conversation.compact' | 'conversation.retry' | 'conversation.retryAbort' | 'conversation.stats'
  | 'session.resume' | 'session.fork' | 'session.tree' | 'session.clone'
  | 'session.switch' | 'session.entries' | 'session.bash' | 'session.rename' | 'session.export'
  | 'model.list' | 'model.select' | 'thinking.select'
  | 'resources.skills' | 'resources.promptTemplates' | 'extensions.ui';

export interface PiCapabilityRecord {
  id: PiCapabilityId;
  rpcCommands: readonly string[];
  status: 'integrated' | 'protocol-ready' | 'needs-runtime-verification' | 'product-discussion';
}

export const piCapabilities: readonly PiCapabilityRecord[] = [
  { id: 'conversation.stream', rpcCommands: ['prompt'], status: 'integrated' },
  { id: 'conversation.queue', rpcCommands: ['steer', 'follow_up', 'clear_queue'], status: 'integrated' },
  { id: 'conversation.queueModes', rpcCommands: ['set_steering_mode', 'set_follow_up_mode'], status: 'integrated' },
  { id: 'conversation.compact', rpcCommands: ['compact', 'set_auto_compaction'], status: 'integrated' },
  { id: 'conversation.retry', rpcCommands: ['set_auto_retry'], status: 'integrated' },
  { id: 'conversation.retryAbort', rpcCommands: ['abort_retry'], status: 'integrated' },
  { id: 'conversation.stats', rpcCommands: ['get_session_stats'], status: 'integrated' },
  { id: 'session.resume', rpcCommands: ['new_session', 'switch_session'], status: 'needs-runtime-verification' },
  { id: 'session.fork', rpcCommands: ['fork', 'get_fork_messages'], status: 'integrated' },
  { id: 'session.tree', rpcCommands: ['get_tree'], status: 'integrated' },
  { id: 'session.clone', rpcCommands: ['clone'], status: 'integrated' },
  { id: 'session.switch', rpcCommands: ['switch_session'], status: 'needs-runtime-verification' },
  { id: 'session.entries', rpcCommands: ['get_entries'], status: 'protocol-ready' },
  { id: 'session.bash', rpcCommands: ['bash', 'abort_bash'], status: 'product-discussion' },
  { id: 'session.rename', rpcCommands: ['set_session_name'], status: 'integrated' },
  { id: 'session.export', rpcCommands: ['export_html'], status: 'product-discussion' },
  { id: 'model.list', rpcCommands: ['get_available_models'], status: 'integrated' },
  { id: 'model.select', rpcCommands: ['set_model', 'cycle_model'], status: 'integrated' },
  { id: 'thinking.select', rpcCommands: ['get_available_thinking_levels', 'set_thinking_level', 'cycle_thinking_level'], status: 'integrated' },
  { id: 'resources.skills', rpcCommands: ['get_commands'], status: 'integrated' },
  { id: 'resources.promptTemplates', rpcCommands: ['get_commands'], status: 'integrated' },
  { id: 'extensions.ui', rpcCommands: ['extension_ui_response'], status: 'integrated' },
] as const;

/** Capability inventory for the installed Pi RPC surface. Keep this explicit: it is not an arbitrary command escape hatch. */
export type PiCapabilityId =
  | 'conversation.stream' | 'conversation.queue' | 'conversation.compact'
  | 'session.resume' | 'session.fork' | 'session.tree' | 'session.clone'
  | 'session.switch' | 'session.rename' | 'session.export'
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
  { id: 'conversation.compact', rpcCommands: ['compact', 'set_auto_compaction'], status: 'protocol-ready' },
  { id: 'session.resume', rpcCommands: ['new_session', 'switch_session'], status: 'needs-runtime-verification' },
  { id: 'session.fork', rpcCommands: ['fork', 'get_fork_messages'], status: 'protocol-ready' },
  { id: 'session.tree', rpcCommands: ['get_tree'], status: 'protocol-ready' },
  { id: 'session.clone', rpcCommands: ['clone'], status: 'needs-runtime-verification' },
  { id: 'session.switch', rpcCommands: ['switch_session'], status: 'needs-runtime-verification' },
  { id: 'session.rename', rpcCommands: ['set_session_name'], status: 'integrated' },
  { id: 'session.export', rpcCommands: ['export_html'], status: 'product-discussion' },
  { id: 'model.list', rpcCommands: ['get_available_models'], status: 'needs-runtime-verification' },
  { id: 'model.select', rpcCommands: ['set_model', 'cycle_model'], status: 'protocol-ready' },
  { id: 'thinking.select', rpcCommands: ['get_available_thinking_levels', 'set_thinking_level', 'cycle_thinking_level'], status: 'protocol-ready' },
  { id: 'resources.skills', rpcCommands: ['get_commands'], status: 'integrated' },
  { id: 'resources.promptTemplates', rpcCommands: ['get_commands'], status: 'integrated' },
  { id: 'extensions.ui', rpcCommands: ['extension_ui_response'], status: 'integrated' },
] as const;

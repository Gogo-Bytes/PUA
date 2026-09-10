import { completedTool, type ConversationBlock, type ConversationHistoryItem, type ConversationMessage, type ConversationObject, type ConversationStreamInput, type ConversationStreamNotification, type ToolExecution } from '../domain/stream.js';
import type { ArgumentDecoderPort, StreamSchedulePort } from '../ports.js';

type Location = { messageId?: string; blockIndex?: number };
type Fragment = Extract<ConversationStreamNotification, { type: 'fragment' }>;
const pendingTool = (id: string, name = 'tool'): ToolExecution => ({ id, name, arguments: {}, status: 'pending', output: '' });
const terminal = (tool: ToolExecution): boolean => tool.status === 'success' || tool.status === 'error';

/** One worker's stream correlation authority, not a second transcript store.
 * Inputs/notifications and JSON leaves are read-only. Observer failures invalidate
 * synchronously and propagate; the adapter owns transport failure/cleanup.
 */
export class ConversationStreamApplication {
  private active = true;
  private activeMessageId?: string;
  private activeUserMessageId?: string;
  private readonly tools = new Map<string, ToolExecution>();
  private readonly finalTools = new Set<string>();
  private readonly retiredTools = new Set<string>();
  private readonly toolLocations = new Map<string, Location>();
  private deltaBuffer = new Map<string, Fragment>();
  private scheduled?: { cancel: () => void };

  constructor(private readonly schedule: StreamSchedulePort, private readonly decoder: ArgumentDecoderPort, private readonly observe: (notification: ConversationStreamNotification) => void) {}

  invalidate(): void {
    if (!this.active) return;
    this.active = false;
    this.scheduled?.cancel();
    this.scheduled = undefined;
    this.deltaBuffer.clear();
  }

  initializeHistory(items: readonly ConversationHistoryItem[]): readonly ConversationMessage[] {
    if (!this.active) return [];
    const messages: ConversationMessage[] = [];
    const locations = new Map<string, { messageIndex: number; blockIndex: number }>();
    for (const item of items) {
      if (item.type === 'result') {
        // Historical empty IDs and results preceding a declaration are ignored.
        const location = item.result.toolId ? locations.get(item.result.toolId) : undefined;
        if (!location) continue;
        const message = messages[location.messageIndex];
        const blocks = [...message.blocks];
        const block = blocks[location.blockIndex];
        if (block.type === 'tool') blocks[location.blockIndex] = { type: 'tool', tool: completedTool(block.tool, item.result) };
        messages[location.messageIndex] = { ...message, blocks };
      } else {
        item.message.blocks.forEach((block, blockIndex) => {
          if (block.type === 'tool') locations.set(block.tool.id, { messageIndex: messages.length, blockIndex });
        });
        messages.push(item.message);
      }
    }
    // Seed only those IDs in history; retain unrelated live ledger entries.
    for (const message of messages) this.seed(message);
    return messages;
  }

  accept(input: ConversationStreamInput): void {
    if (!this.active) return;
    switch (input.type) {
      case 'invalid-fragment-index':
        if (this.activeMessageId) this.publish({ type: 'fragment-index-rejected' });
        return;
      case 'message-began': {
        let message = input.message;
        if (message.role === 'assistant') { this.activeMessageId = message.id; message = { ...message, streaming: true }; }
        if (message.role === 'user') this.activeUserMessageId = message.id;
        this.seed(message);
        this.publish({ type: 'message-began', message });
        return;
      }
      case 'fragment':
        if (this.activeMessageId) this.queueDelta({ ...input, messageId: this.activeMessageId });
        return;
      case 'tool-declared': {
        if (!this.activeMessageId) return;
        const tool = this.tools.get(input.toolId) ?? pendingTool(input.toolId, input.name);
        this.toolLocations.set(tool.id, { messageId: this.activeMessageId, blockIndex: input.blockIndex });
        this.toolChanged(tool);
        return;
      }
      case 'arguments-fragment': {
        if (!this.activeMessageId) return;
        const location = [...this.toolLocations.entries()].find(([, value]) => value.messageId === this.activeMessageId && value.blockIndex === input.blockIndex);
        if (!location) return;
        const tool = this.tools.get(location[0])!;
        const details = tool.details;
        const previous = details && typeof details === 'object' && !Array.isArray(details) ? (details as ConversationObject).argumentText : undefined;
        // Execution details intentionally replace provisional argumentText, as before.
        const text = String(previous ?? '') + input.delta;
        this.toolChanged({ ...tool, arguments: this.decoder.decode(text) ?? tool.arguments, details: { argumentText: text } });
        return;
      }
      case 'declaration-completed': {
        if (!this.activeMessageId) return;
        const current = this.tools.get(input.toolId) ?? pendingTool(input.toolId);
        const tool = { ...current, name: input.name ?? current.name, arguments: input.arguments ?? current.arguments, details: undefined };
        this.toolLocations.set(tool.id, { messageId: this.activeMessageId, blockIndex: input.blockIndex });
        this.toolChanged(tool);
        return;
      }
      case 'message-boundary': {
        this.flushDeltas();
        if (!this.active) return;
        if (input.result) {
          const tool = this.tools.get(input.result.toolId);
          if (tool) this.toolChanged(completedTool(tool, input.result));
          return;
        }
        if (!input.message) return;
        let message = input.message;
        if (message.role === 'assistant' && this.activeMessageId) {
          message = { ...message, id: this.activeMessageId, streaming: false }; this.activeMessageId = undefined;
        }
        if (message.role === 'user' && this.activeUserMessageId) {
          message = { ...message, id: this.activeUserMessageId }; this.activeUserMessageId = undefined;
        }
        const finalIds = new Set(message.blocks.flatMap(block => block.type === 'tool' ? [block.tool.id] : []));
        for (const [id, location] of this.toolLocations) {
          if (location.messageId === message.id && !finalIds.has(id)) {
            this.retiredTools.add(id); this.tools.delete(id); this.toolLocations.delete(id);
          }
        }
        for (const id of finalIds) this.finalTools.add(id);
        const blocks = message.blocks.map((block): ConversationBlock => {
          if (block.type !== 'tool') return block;
          const current = this.tools.get(block.tool.id);
          return current ? { type: 'tool', tool: { ...current, name: block.tool.name, arguments: block.tool.arguments } } : block;
        });
        message = { ...message, blocks };
        this.seed(message);
        this.publish({ type: 'message-completed', message });
        return;
      }
      case 'execution-began': {
        if (this.retiredTools.has(input.toolId)) return;
        const current = this.tools.get(input.toolId) ?? pendingTool(input.toolId, input.name);
        this.toolChanged({ ...current, status: terminal(current) ? current.status : 'running', arguments: !this.finalTools.has(current.id) && input.arguments ? input.arguments : current.arguments });
        return;
      }
      case 'execution-progressed':
      case 'execution-finished': {
        if (this.retiredTools.has(input.toolId)) return;
        const current = this.tools.get(input.toolId) ?? { ...pendingTool(input.toolId, input.name), arguments: input.arguments ?? {} };
        const tool = input.type === 'execution-finished'
          ? completedTool(current, { toolId: input.toolId, result: input.result, failed: input.failed })
          : terminal(current) ? current : { ...current, ...input.result, status: 'running' as const };
        this.toolChanged(tool);
      }
    }
  }

  private seed(message: ConversationMessage): void {
    message.blocks.forEach((block, blockIndex) => {
      if (block.type === 'tool') {
        this.tools.set(block.tool.id, block.tool);
        this.toolLocations.set(block.tool.id, { messageId: message.id, blockIndex });
      }
    });
  }
  private toolChanged(tool: ToolExecution): void {
    this.tools.set(tool.id, tool);
    this.publish({ type: 'tool-changed', ...this.toolLocations.get(tool.id), tool });
  }
  private publish(notification: ConversationStreamNotification): void {
    if (!this.active) return;
    try { this.observe(notification); }
    catch (error) { this.invalidate(); throw error; }
  }
  private queueDelta(fragment: Fragment): void {
    const key = `${fragment.messageId}:${fragment.blockIndex}:${fragment.blockType}`;
    const current = this.deltaBuffer.get(key);
    this.deltaBuffer.set(key, current ? { ...current, delta: current.delta + fragment.delta } : fragment);
    if (!this.scheduled) {
      const identity = { cancel: () => {} };
      this.scheduled = identity;
      identity.cancel = this.schedule.after(24, () => {
        if (this.active && this.scheduled === identity) this.flushDeltas();
      });
    }
  }
  private flushDeltas(): void {
    this.scheduled?.cancel(); this.scheduled = undefined;
    // Detach before callbacks: close cannot replay, new input cannot be cleared by this batch.
    const batch = this.deltaBuffer; this.deltaBuffer = new Map();
    for (const fragment of batch.values()) {
      if (!this.active) return;
      this.publish(fragment);
    }
  }
}

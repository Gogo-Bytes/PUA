import type { ExtensionUIRequest, ExtensionUIResponse } from '../shared/chat.js';
import { extensionResponse } from '../shared/chat-validation.js';

/** Waiting for UI is orthogonal to an agent run; dialog completion never starts one. */
export class ExtensionDialogs {
  private pending = new Map<string, { request: ExtensionUIRequest; timer?: ReturnType<typeof setTimeout> }>();
  constructor(private retired: (id: string) => void) {}
  get waiting(): boolean { return this.pending.size > 0; }
  add(request: ExtensionUIRequest): void {
    if (this.pending.has(request.id)) throw new Error('Duplicate extension dialog id');
    if (this.pending.size >= 32) throw new Error('Too many pending extension dialogs');
    const delay = request.expiresAt === undefined ? undefined : Math.max(0, request.expiresAt - Date.now());
    const timer = delay === undefined ? undefined : setTimeout(() => this.remove(request.id), delay);
    this.pending.set(request.id, { request, timer });
  }
  answer(raw: unknown): ExtensionUIResponse {
    const response = extensionResponse(raw);
    const item = this.pending.get(response.id);
    if (!item || (item.request.expiresAt !== undefined && item.request.expiresAt <= Date.now())) throw new Error('扩展对话已结束');
    if (!('cancelled' in response)) {
      if (item.request.method === 'confirm' ? !('confirmed' in response) : !('value' in response)) throw new Error('扩展响应类型不匹配');
      if (item.request.method === 'select' && 'value' in response && !item.request.options.includes(response.value)) throw new Error('无效选项');
    }
    return response;
  }
  remove(id: string): void {
    const item = this.pending.get(id); if (!item) return;
    clearTimeout(item.timer); this.pending.delete(id); this.retired(id);
  }
  clear(): void { for (const id of this.pending.keys()) this.remove(id); }
}

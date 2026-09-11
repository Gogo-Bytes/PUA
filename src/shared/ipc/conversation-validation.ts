import type { ExtensionUIResponse } from './conversation.js';

export const MAX_CONTENT_BLOCKS = 4096;
export function validBlockIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < MAX_CONTENT_BLOCKS;
}

/** Reconstruct the union: renderer-owned extra fields must never reach Pi. */
export function extensionResponse(value: unknown): ExtensionUIResponse {
  if (!value || typeof value !== 'object') throw new Error('无效扩展响应');
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !input.id || input.id.length > 256) throw new Error('无效扩展响应 id');
  if (['value', 'confirmed', 'cancelled'].filter(key => Object.hasOwn(input, key)).length !== 1) throw new Error('扩展响应需要唯一结果');
  if (typeof input.value === 'string' && input.value.length <= 1024 * 1024) return { id: input.id, value: input.value };
  if (typeof input.confirmed === 'boolean') return { id: input.id, confirmed: input.confirmed };
  if (input.cancelled === true) return { id: input.id, cancelled: true };
  throw new Error('无效扩展响应结果');
}

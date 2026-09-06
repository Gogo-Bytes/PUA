import path from 'node:path';

export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS = 20;

const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export function imageMimeType(file: string): string | undefined { return imageTypes[path.extname(file).toLowerCase()]; }

export function validateImageBudget(existing: Array<{ size: number }>, candidate: { name: string; size: number }): void {
  if (existing.length + 1 > MAX_CHAT_IMAGES) throw new Error(`图片最多 ${MAX_CHAT_IMAGES} 张`);
  if (candidate.size > MAX_CHAT_IMAGE_BYTES) throw new Error(`${candidate.name} 超过 5 MiB`);
  if (existing.reduce((sum, item) => sum + item.size, 0) + candidate.size > MAX_CHAT_IMAGE_TOTAL_BYTES) throw new Error('图片总大小超过 10 MiB');
}

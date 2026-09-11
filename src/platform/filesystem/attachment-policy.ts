import path from 'node:path';

const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export function imageMimeType(file: string): string | undefined { return imageTypes[path.extname(file).toLowerCase()]; }

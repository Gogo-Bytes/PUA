import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PersistedChatSession } from './workspace-session-store.js';

const MAX_FILES = 2000;
const MAX_HEADER_BYTES = 128 * 1024;
const MAX_TITLE_LENGTH = 4096;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function messageText(message: JsonObject): string {
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map(block => {
      const item = object(block);
      return item?.type === 'text' ? text(item.text) : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function titleFor(entries: JsonObject[], cwd: string): string {
  const named = [...entries].reverse().find(entry => entry.type === 'session_info' && text(object(entry.data)?.name));
  const namedValue = text(object(named?.data)?.name);
  if (namedValue) return namedValue.slice(0, MAX_TITLE_LENGTH);
  const firstUser = entries.find(entry => object(entry.message)?.role === 'user');
  const prompt = messageText(object(firstUser?.message) ?? {});
  if (prompt) return prompt.replace(/\s+/g, ' ').slice(0, 120);
  return path.basename(cwd) || '未命名会话';
}

async function readHeader(file: string): Promise<PersistedChatSession | undefined> {
  let info;
  try {
    info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 64 * 1024 * 1024) return;
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(file, constants.O_RDONLY | noFollow);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== info.dev || stat.ino !== info.ino) return;
      const bytes = Buffer.alloc(Math.min(MAX_HEADER_BYTES, stat.size));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const lines = bytes.subarray(0, bytesRead).toString('utf8').split(/\r?\n/).filter(Boolean);
      const entries: JsonObject[] = [];
      for (const line of lines) {
        try {
          const parsed = object(JSON.parse(line));
          if (parsed) entries.push(parsed);
        } catch {
          /* A partial trailing line is harmless during discovery. */
        }
        if (entries.length >= 80) break;
      }
      const header = entries[0];
      if (header?.type !== 'session' || !text(header.id) || !path.isAbsolute(text(header.cwd))) return;
      const piSessionId = text(header.id);
      const cwd = text(header.cwd);
      const id = `pi-${createHash('sha256').update(piSessionId).digest('hex').slice(0, 32)}`;
      return {
        id,
        cwd,
        title: titleFor(entries, cwd),
        piSessionId,
        sessionFile: file,
        archived: false,
        pinned: false,
        lastActivityAt: Number.isFinite(info.mtimeMs) ? info.mtimeMs : 0,
      };
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
}

function configuredRoots(home: string): string[] {
  const configured = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  const defaultRoot = path.join(home, '.pi', 'agent', 'sessions');
  return [
    ...new Set(
      [configured ? (configured.startsWith('~/') ? path.join(home, configured.slice(2)) : configured) : '', defaultRoot].filter(Boolean),
    ),
  ];
}

/** Discover sessions written directly by Pi so PUA and Pi use one transcript source. */
export async function discoverNativePiSessions(home: string): Promise<PersistedChatSession[]> {
  const found: PersistedChatSession[] = [];
  for (const root of configuredRoots(home)) {
    let groups: string[];
    try {
      groups = await readdir(root);
    } catch {
      continue;
    }
    let scanned = 0;
    for (const group of groups) {
      if (scanned >= MAX_FILES) break;
      const groupPath = path.join(root, group);
      let files: string[];
      try {
        const stat = await lstat(groupPath);
        files =
          stat.isDirectory() && !stat.isSymbolicLink() ? (await readdir(groupPath)).map(name => path.join(groupPath, name)) : [groupPath];
      } catch {
        continue;
      }
      for (const file of files) {
        if (scanned++ >= MAX_FILES || !file.endsWith('.jsonl')) break;
        const result = await readHeader(file);
        if (result) found.push(result);
      }
    }
  }
  const unique = new Map<string, PersistedChatSession>();
  for (const record of found) unique.set(record.piSessionId, record);
  return [...unique.values()].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
}

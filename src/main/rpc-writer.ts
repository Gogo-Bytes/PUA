import type { Writable } from 'node:stream';

type WriteItem = { data: string; resolve(): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> };
/** A stalled stdin must not accumulate unlimited prompts. Rejection never replays a command. */
export class RpcWriter {
  private queuedBytes = 0;
  private blocked = false;
  private queue: WriteItem[] = [];
  private active = new Set<WriteItem>();
  private failure?: Error;
  get failed(): boolean { return !!this.failure; }
  constructor(private stream: Writable, private maxBytes = 32 * 1024 * 1024, private stallMs = 15_000) {
    stream.on('drain', () => { this.blocked = false; this.flush(); });
    stream.on('error', error => this.close(error));
    stream.on('close', () => this.close(new Error('Pi input closed; acceptance unknown')));
  }
  write(value: unknown): Promise<void> {
    const data = `${JSON.stringify(value)}\n`;
    const size = Buffer.byteLength(data);
    if (this.failure) return Promise.reject(this.failure);
    if (size + this.queuedBytes + this.stream.writableLength > this.maxBytes) return Promise.reject(new Error('Pi input backlog full; message not submitted'));
    return new Promise((resolve, reject) => { this.queue.push({ data, resolve, reject }); this.queuedBytes += size; this.flush(); });
  }
  close(error: Error): void {
    this.failure ??= error;
    for (const item of [...this.queue.splice(0), ...this.active]) { clearTimeout(item.timer); item.reject(this.failure); }
    this.active.clear(); this.queuedBytes = 0;
  }
  private flush(): void {
    while (!this.blocked && this.queue.length && !this.failure) {
      const item = this.queue.shift()!; this.queuedBytes -= Buffer.byteLength(item.data); this.active.add(item);
      item.timer = setTimeout(() => { const error = new Error('Pi input stalled; acceptance unknown, not replayed'); this.close(error); this.stream.destroy(error); }, this.stallMs);
      item.timer.unref();
      this.blocked = !this.stream.write(item.data, error => {
        clearTimeout(item.timer); this.active.delete(item);
        if (error) { item.reject(error); this.close(error); } else item.resolve();
      });
    }
  }
}

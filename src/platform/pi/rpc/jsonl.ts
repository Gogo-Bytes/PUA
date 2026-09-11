import { StringDecoder } from 'node:string_decoder';

export const MAX_RPC_RECORD_BYTES = 64 * 1024 * 1024;

/** Strict LF-only JSONL decoder. U+2028/U+2029 remain ordinary JSON string data. */
export class JsonlDecoder {
  private decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(
    private readonly onValue: (value: unknown) => void,
    private readonly maxBytes = MAX_RPC_RECORD_BYTES,
  ) {}

  push(chunk: Buffer | Uint8Array | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(Buffer.from(chunk));
    this.drain(false);
  }

  end(): void {
    this.buffer += this.decoder.end();
    this.drain(true);
  }

  private drain(eof: boolean): void {
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      let line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.parse(line);
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > this.maxBytes) throw new Error(`Pi RPC record exceeds ${this.maxBytes} bytes`);
    if (eof && this.buffer.length > 0) {
      let line = this.buffer;
      this.buffer = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.parse(line);
    }
  }

  private parse(line: string): void {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, 'utf8') > this.maxBytes) throw new Error(`Pi RPC record exceeds ${this.maxBytes} bytes`);
    try { this.onValue(JSON.parse(line)); }
    catch (error) { throw new Error(`Malformed Pi RPC JSON: ${(error as Error).message}`); }
  }
}

export class TailBuffer {
  private value = '';
  constructor(private readonly maxBytes = 64 * 1024) {}
  append(chunk: Buffer | string): void {
    this.value += chunk.toString();
    while (Buffer.byteLength(this.value, 'utf8') > this.maxBytes) this.value = this.value.slice(Math.ceil(this.value.length / 8));
  }
  toString(): string { return this.value; }
}

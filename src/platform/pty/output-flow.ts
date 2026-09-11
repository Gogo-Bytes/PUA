/** Acknowledge only after xterm has parsed data; stop the PTY before IPC grows unbounded. */
export class OutputFlow {
  private pending = 0;
  private paused = false;
  constructor(private pause: () => void, private resume: () => void, private high = 256 * 1024, private low = 64 * 1024) {}
  sent(size: number): void {
    this.pending += size;
    if (!this.paused && this.pending >= this.high) { this.paused = true; this.pause(); }
  }
  acknowledge(size: number): void {
    if (!Number.isSafeInteger(size) || size <= 0) return;
    this.pending = Math.max(0, this.pending - size);
    if (this.paused && this.pending <= this.low) { this.paused = false; this.resume(); }
  }
}

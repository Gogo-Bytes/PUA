/** Submission-only PTY capability, implemented directly by the process Adapter.
 * Session alone owns admission/closing/exclusivity. No input is cached before running.
 * Resize caches valid startup dimensions; ACK counts JS characters, not UTF-8 bytes.
 * write/valid resize throw for missing IDs; acknowledge ignores missing/closed resources.
 * void does not acknowledge execution or rendering.
 */
export interface Terminal {
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  acknowledge(id: string, size: number): void;
}

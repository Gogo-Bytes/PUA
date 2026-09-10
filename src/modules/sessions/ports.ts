export type SessionProcessEvent =
  | { type: 'ready'; id: string }
  | { type: 'title-changed'; id: string; title: string }
  | { type: 'transport-ended'; id: string }
  | { type: 'start-failed'; id: string; detail: string };

/** ID-addressed resources. close succeeds only after host exit AND registered child cleanup.
 * start may emit synchronously; failures after return must emit start-failed/transport-ended.
 * Registration belongs to composition, is synchronous, and must never start external work. */
export interface SessionProcessPort {
  start(id: string): void | Promise<void>;
  close(id: string): Promise<{ exitCode: number }>;
  observe(listener: (event: SessionProcessEvent) => void): void;
}

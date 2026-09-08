import type { ReactNode } from 'react';
import { Icon, Collapsible, type RunStatus } from '../ui';

export interface ToolExecutionCardProps {
  title: string;
  status: RunStatus;
  duration?: string;
  /** Decorative tool/integration identity, without interactive elements. */
  icon?: ReactNode;
  children: ReactNode;
  labels?: { details?: string; statuses?: Partial<Record<RunStatus, string>> };
}
const statuses: Record<RunStatus, string> = { idle: 'Idle', running: 'Running', success: 'Complete', error: 'Failed', paused: 'Paused' };

export function ToolExecutionCard({ title, status, duration, icon, children, labels }: ToolExecutionCardProps) {
  const state = labels?.statuses?.[status] ?? statuses[status];
  return <div className={`ui-tool-card ui-tool-${status}`}>
    <Collapsible label={`${title} · ${labels?.details ?? 'Execution details'} · ${state}`} title={<>
      <span className="ui-tool-icon" aria-hidden="true">{icon ?? <Icon name={status === 'error' ? 'error' : status === 'running' ? 'running' : 'terminal'}/>}</span>
      <span className="ui-tool-title">{title}</span>
      <span className={status === 'success' ? 'ui-visually-hidden' : 'ui-tool-state'}>{state}</span>
      {duration && <span className="ui-tool-duration">{duration}</span>}
    </>}>{children}</Collapsible>
  </div>;
}

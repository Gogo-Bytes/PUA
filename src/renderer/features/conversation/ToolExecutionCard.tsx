import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Collapsible, type RunStatus } from '../../ui';

export interface ToolExecutionCardProps {
  title: string;
  status: RunStatus;
  duration?: string;
  /** Decorative tool/integration identity, without interactive elements. */
  icon?: ReactNode;
  children: ReactNode;
  labels?: { details?: string; statuses?: Partial<Record<RunStatus, string>> };
  nativeDetails?: boolean;
  defaultOpen?: boolean;
  openOnError?: boolean;
  triggerTitle?: string;
  className?: string;
}
const statuses: Record<RunStatus, string> = { idle: 'Idle', running: 'Running', success: 'Complete', error: 'Failed', paused: 'Paused' };

export function ToolExecutionCard({ title, status, duration, icon, children, labels, nativeDetails = false, defaultOpen = false, openOnError = false, triggerTitle, className = '' }: ToolExecutionCardProps) {
  const state = labels?.statuses?.[status] ?? statuses[status];
  const [open, setOpen] = useState(defaultOpen || (openOnError && status === 'error'));
  useEffect(() => { if (openOnError && status === 'error') setOpen(true); }, [openOnError, status]);
  if (nativeDetails) return <details className={`ui-tool-card ui-tool-${status} tool-card ${className}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary title={triggerTitle}>{icon ?? <Icon name={status === 'error' ? 'close' : status === 'success' ? 'check' : 'code'}/>}<strong>{title}</strong><small>{state}</small>{duration && <small>{duration}</small>}<span className="disclosure"><Icon name="chevron"/></span></summary>{children}</details>;
  return <div className={`ui-tool-card ui-tool-${status} ${className}`}>
    <Collapsible label={`${title} · ${labels?.details ?? 'Execution details'} · ${state}`} title={<>
      <span className="ui-tool-icon" aria-hidden="true">{icon ?? <Icon name={status === 'error' ? 'error' : status === 'running' ? 'running' : 'terminal'}/>}</span>
      <span className="ui-tool-title">{title}</span>
      <span className={status === 'success' ? 'ui-visually-hidden' : 'ui-tool-state'}>{state}</span>
      {duration && <span className="ui-tool-duration">{duration}</span>}
    </>} defaultOpen={defaultOpen}>{children}</Collapsible>
  </div>;
}

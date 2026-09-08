import type { ReactNode } from 'react';
import { Icon, StatusBadge, Collapsible, type RunStatus } from '../ui';
export function ToolExecutionCard({ title, status, duration, children, labels }: { title: string; status: RunStatus; duration?: string; children: ReactNode; labels?: { details?: string; statuses?: Partial<Record<RunStatus, string>> } }) {
  return <div className="ui-tool-card"><div className="ui-tool-heading"><Icon name="code"/><strong>{title}</strong><StatusBadge status={status} label={labels?.statuses?.[status]}/>{duration && <span className="ui-meta">{duration}</span>}</div><Collapsible title={labels?.details ?? 'Execution details'}>{children}</Collapsible></div>;
}

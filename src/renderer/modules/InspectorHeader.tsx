import { Tag, IconButton } from '../ui';
export function InspectorHeader({ title, count, onRefresh, labels }: { title: string; count: number; onRefresh(): void; labels?: { refresh?: string } }) {
  return <div className="ui-module-heading"><strong>{title}</strong><Tag>{count}</Tag><IconButton label={labels?.refresh ?? 'Refresh inspection'} icon="refresh" variant="ghost" onClick={onRefresh}/></div>;
}

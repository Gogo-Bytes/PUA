import type { ReactNode } from 'react';
import { IconButton, Tag } from '../../ui';

export interface InspectorHeaderLabels { refresh?: string; close?: string }
export interface InspectorHeaderProps {
  title: string;
  count: ReactNode;
  onRefresh?(): void;
  onClose?(): void;
  labels?: InspectorHeaderLabels;
  refreshing?: boolean;
}

export function InspectorHeader({ title, count, onRefresh, onClose, labels, refreshing = false }: InspectorHeaderProps) {
  return <div className="ui-module-heading ui-inspector-header"><strong>{title}</strong><Tag>{count}</Tag>{onRefresh && <IconButton label={labels?.refresh ?? 'Refresh inspection'} icon={refreshing ? 'running' : 'refresh'} disabled={refreshing} aria-busy={refreshing || undefined} variant="ghost" onClick={onRefresh}/>}{onClose && <IconButton label={labels?.close ?? 'Close inspector'} icon="close" variant="ghost" onClick={onClose}/>}</div>;
}

import type { ReactNode } from 'react';
import { Icon, IconButton, Tag } from '../../ui';

export interface InspectorHeaderLabels { refresh?: string; close?: string }
export interface InspectorHeaderProps {
  title: string;
  count: ReactNode;
  onRefresh?(): void;
  onClose?(): void;
  labels?: InspectorHeaderLabels;
  icon?: Parameters<typeof Icon>[0]['name'];
  variant?: 'module' | 'panel';
}

export function InspectorHeader({ title, count, onRefresh, onClose, labels, icon, variant = 'module' }: InspectorHeaderProps) {
  if (variant === 'panel') return <header className="ui-inspector-header ui-inspector-header-panel"><div>{icon && <Icon name={icon}/>}<h2>{title}</h2><span className="count">{count}</span></div>{onClose && <IconButton label={labels?.close ?? 'Close inspector'} icon="close" variant="ghost" onClick={onClose}/>}</header>;
  return <div className="ui-module-heading ui-inspector-header"><strong>{title}</strong><Tag>{count}</Tag>{onRefresh && <IconButton label={labels?.refresh ?? 'Refresh inspection'} icon="refresh" variant="ghost" onClick={onRefresh}/>}</div>;
}

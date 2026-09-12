import type { ReactNode } from 'react';
import { Button, Icon } from '../../ui';

export interface FileRowProps {
  name: string;
  detail: ReactNode;
  onOpen(): void;
  labels?: { open?: string };
  selected?: boolean;
  title?: string;
  detailClassName?: string;
  detailElement?: 'small' | 'code';
}

export function FileRow({ name, detail, onOpen, labels, selected, title, detailClassName, detailElement = 'small' }: FileRowProps) {
  const trailing = detailElement === 'code' ? <code className={detailClassName}>{detail}</code> : <small className={detailClassName}>{detail}</small>;
  return <Button aria-label={labels?.open} aria-pressed={selected} title={title} variant="ghost" className="ui-file-row" onClick={onOpen}><Icon name="file"/><span>{name}</span>{trailing}</Button>;
}

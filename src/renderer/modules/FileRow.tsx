import { Button, Icon } from '../ui';
export function FileRow({ name, detail, onOpen, labels }: { name: string; detail: string; onOpen(): void; labels?: { open?: string } }) {
  return <Button aria-label={labels?.open} variant="ghost" className="ui-file-row" onClick={onOpen}><Icon name="file"/><span>{name}</span><small>{detail}</small></Button>;
}

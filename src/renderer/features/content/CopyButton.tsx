import { useEffect, useState } from 'react';
import { desktopClient } from '../../app/desktop-client';
import { Button, Icon } from '../../ui';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDone(false); setError(''); }, [text]);
  return <span className="copy-action"><Button className="copy-button" variant="ghost" aria-label={label} onClick={() => {
    setError(''); setDone(false);
    void desktopClient.writeClipboard(text).then(() => setDone(true)).catch(error => setError(`复制失败：${String(error)}`));
  }}><Icon name={done ? 'check' : 'copy'} />{done ? '已复制' : '复制'}</Button>{error && <span role="alert" className="form-error">{error}</span>}</span>;
}

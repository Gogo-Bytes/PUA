import { useEffect, useId, useRef } from 'react';
import { Icon } from './Icon';

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current; dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}><header><h2 id={id}>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><Icon name="close" /></button></header>{children}</dialog>;
}

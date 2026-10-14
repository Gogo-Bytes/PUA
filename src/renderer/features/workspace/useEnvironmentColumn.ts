import { useRef, useState } from 'react';

/** Workspace owns intent; ResizableWorkspace reports whether it can fit it. */
export function useEnvironmentColumn() {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };
  return {
    open,
    visible,
    toggleRef,
    onVisibilityChange: setVisible,
    toggle: () => setOpen(current => !current),
    close,
    label: visible ? '收起环境与任务信息' : open ? '关闭环境与任务信息（空间不足，扩大窗口后自动恢复）' : '显示环境与任务信息',
  };
}

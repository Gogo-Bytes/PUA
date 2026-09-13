/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { expect, it, vi } from 'vitest';
import './component-preview/test-setup';
import { Button, Dialog, Select, DropdownMenu, Tooltip, UIProvider } from '../src/renderer/ui';
it('Dialog focuses the requested field after opening and restores the opener on cancel and reopen', () => {
  function Example() {
    const [open, setOpen] = useState(false), input = useRef<HTMLInputElement>(null);
    return <UIProvider motion="off"><Button onClick={() => setOpen(true)}>Open</Button><Dialog open={open} title="Edit" initialFocusRef={input} onClose={() => setOpen(false)}><input ref={input} aria-label="Name"/></Dialog></UIProvider>;
  }
  render(<Example/>);
  const opener = screen.getByRole('button', { name: 'Open' });
  for (let attempt = 0; attempt < 2; attempt++) {
    opener.focus(); fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(document.activeElement).toBe(opener);
  }
});
it.each([true, false])('Dialog loops through radio group tab stops while submission is disabled (checked=%s)', checked => {
  render(<UIProvider motion="off"><Dialog open title="Pending" onClose={() => {}}>
    <input type="radio" name="mode" aria-label="New" defaultChecked={checked}/><input type="radio" name="mode" aria-label="Continue"/>
    <Button disabled>Submit</Button><Button tabIndex={-1}>Excluded</Button><div style={{ display: 'none' }}><Button>Hidden</Button></div><fieldset disabled><Button>Busy</Button></fieldset>
  </Dialog></UIProvider>);
  const first = screen.getByRole('button', { name: 'Close dialog' }), last = screen.getByRole('radio', { name: 'New' });
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
});
it('Select focuses selection, skips disabled, navigates Home/End/arrows and restores focus on Escape/commit', async () => {
  const change = vi.fn(), user = userEvent.setup();
  render(<UIProvider motion="off"><Select label="Choice" value="b" options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Disabled', disabled: true }, { value: 'd', label: 'Delta' }]} onChange={change}/></UIProvider>);
  const trigger = screen.getByRole('button', { name: 'Choice' }); trigger.focus(); await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Beta' })); await user.keyboard('{ArrowDown}'); expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Delta' }));
  await user.keyboard('{Home}'); expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Alpha' })); await user.keyboard('{End}{Enter}'); expect(change).toHaveBeenCalledWith('d'); expect(document.activeElement).toBe(trigger);
  await user.click(trigger); await user.keyboard('{Escape}'); expect(screen.queryByRole('listbox')).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it('Select closes for an outside pointer and Tab leaves without trapping focus', async () => {
  const user = userEvent.setup(); render(<UIProvider motion="off"><Select label="Choice" value="a" options={[{ value: 'a', label: 'Alpha' }]} onChange={() => {}}/><Button>Outside</Button></UIProvider>);
  await user.click(screen.getByRole('button', { name: 'Choice' })); await user.keyboard('{Tab}'); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('listbox')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Choice' })); fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' })); expect(screen.queryByRole('listbox')).toBeNull();
});
it('DropdownMenu uses the same keyboard seam and reports actions', async () => {
  const action = vi.fn(), user = userEvent.setup(); render(<UIProvider><DropdownMenu label="Actions" items={[{ value: 'copy', label: 'Copy' }]} onAction={action}/></UIProvider>);
  await user.click(screen.getByRole('button', { name: 'Actions' })); await user.keyboard('{Enter}'); expect(action).toHaveBeenCalledWith('copy'); expect(screen.queryByRole('menu')).toBeNull();
});
it('Tooltip opens on hover/focus, describes its actual trigger, and dismisses with Escape', () => {
  vi.useFakeTimers();
  try {
    render(<UIProvider><Tooltip content="Full project path"><Button>Project</Button></Tooltip></UIProvider>);
    const trigger = screen.getByRole('button', { name: 'Project' }); fireEvent.mouseEnter(trigger); expect(screen.getByRole('tooltip')).toBeTruthy(); fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(120)); expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(trigger); expect(trigger.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id); fireEvent.keyDown(trigger, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
  } finally { vi.useRealTimers(); }
});
it('Tooltip keeps hover and focus independently and preserves existing descriptions', () => {
  vi.useFakeTimers();
  try {
    render(<UIProvider><Tooltip content="Details"><Button aria-describedby="hint">Project</Button></Tooltip></UIProvider>);
    const trigger = screen.getByRole('button', { name: 'Project' });
    fireEvent.focus(trigger); fireEvent.mouseEnter(trigger); fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(150)); expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(trigger.getAttribute('aria-describedby')).toBe(`hint ${screen.getByRole('tooltip').id}`);
    fireEvent.mouseEnter(trigger); fireEvent.blur(trigger, { relatedTarget: document.body }); expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull(); expect(trigger.getAttribute('aria-describedby')).toBe('hint');
  } finally { vi.useRealTimers(); }
});
it('Tooltip cleans up popover, scroll/resize listeners, observer and scheduled work on unmount', () => {
  vi.useFakeTimers();
  const show = vi.fn(), hide = vi.fn(), disconnect = vi.fn(), observe = vi.fn();
  const previousShow = HTMLElement.prototype.showPopover, previousHide = HTMLElement.prototype.hidePopover;
  HTMLElement.prototype.showPopover = show; HTMLElement.prototype.hidePopover = hide;
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect = disconnect; });
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener'), cancel = vi.spyOn(window, 'cancelAnimationFrame');
  try {
    const view = render(<UIProvider><Tooltip content="Details"><Button>Project</Button></Tooltip></UIProvider>);
    fireEvent.focus(screen.getByRole('button', { name: 'Project' })); expect(show).toHaveBeenCalledOnce();
    fireEvent.scroll(window); fireEvent.mouseLeave(screen.getByRole('button', { name: 'Project' }));
    view.unmount(); expect(hide).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalled();
    for (const call of add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize')) expect(remove).toHaveBeenCalledWith(...call);
    expect(vi.getTimerCount()).toBe(0);
  } finally { HTMLElement.prototype.showPopover = previousShow; HTMLElement.prototype.hidePopover = previousHide; vi.unstubAllGlobals(); vi.useRealTimers(); }
});
it('Dialog loops Tab at either end and Escape requests closure', async () => {
  const { Dialog } = await import('../src/renderer/ui'); const close = vi.fn();
  render(<UIProvider motion="off"><Dialog open title="Review" onClose={close}><Button>Last action</Button></Dialog></UIProvider>);
  const last = screen.getByRole('button', { name: 'Last action' }), first = screen.getByRole('button', { name: 'Close dialog' });
  last.focus(); fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true })); expect(close).toHaveBeenCalledOnce();
});
it('Dialog can preserve callers that do not close from backdrop clicks', async () => {
  const { Dialog } = await import('../src/renderer/ui'); const close = vi.fn();
  render(<UIProvider motion="off"><Dialog open title="Review" closeDisabled closeOnBackdrop={false} onClose={close}>Content</Dialog></UIProvider>);
  expect((screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled).toBe(true);
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 100, top: 10, bottom: 100 } as DOMRect);
  fireEvent.click(dialog, { clientX: 0, clientY: 0 }); expect(close).not.toHaveBeenCalled();
});

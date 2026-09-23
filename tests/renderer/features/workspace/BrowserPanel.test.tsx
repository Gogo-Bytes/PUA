/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../../../component-preview/test-setup';
import type { BrowserViewState, DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
import { installDesktopFake } from '../../../desktop-bridge-fake';
import { BrowserPanel } from '../../../../src/renderer/features/workspace/BrowserPanel';
import { UIProvider } from '../../../../src/renderer/ui';

afterEach(() => { vi.restoreAllMocks(); });

it('navigates only valid HTTPS or loopback addresses and reflects isolated browser state', async () => {
  let emit: ((state: BrowserViewState) => void) | undefined;
  const navigateBrowser = vi.fn(async (_id: string, url: string) => emit?.({ id: 'view-1', url, title: 'Example', canGoBack: true, canGoForward: false, loading: false }));
  const desktop = installDesktopFake({
    createBrowserView: vi.fn().mockResolvedValue('view-1'), setBrowserViewBounds: vi.fn().mockResolvedValue(undefined),
    navigateBrowser, goBackBrowser: vi.fn().mockResolvedValue(undefined), goForwardBrowser: vi.fn().mockResolvedValue(undefined), reloadBrowser: vi.fn().mockResolvedValue(undefined), disposeBrowserView: vi.fn().mockResolvedValue(undefined),
    onBrowserViewState: (callback: (state: BrowserViewState) => void) => { emit = callback; return () => { emit = undefined; }; },
  } as unknown as DesktopAPI);
  render(<UIProvider><BrowserPanel/></UIProvider>);
  const address = await screen.findByRole('textbox', { name: '浏览器地址' });
  await waitFor(() => expect(desktop.createBrowserView).toHaveBeenCalledOnce());
  fireEvent.change(address, { target: { value: 'javascript:alert(1)' } }); fireEvent.submit(address.closest('form')!);
  expect((await screen.findByRole('alert')).textContent).toContain('请输入 HTTPS 地址');
  expect(navigateBrowser).not.toHaveBeenCalled();
  fireEvent.change(address, { target: { value: 'example.com' } }); fireEvent.submit(address.closest('form')!);
  await waitFor(() => expect(navigateBrowser).toHaveBeenCalledWith('view-1', 'https://example.com/'));
  await waitFor(() => expect((address as HTMLInputElement).value).toBe('https://example.com/'));
  expect((await screen.findByRole('button', { name: '后退' })).hasAttribute('disabled')).toBe(false);
});

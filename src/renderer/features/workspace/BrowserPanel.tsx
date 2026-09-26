import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { desktopClient } from '../../app/desktop-client';
import { normalizeBrowserURL } from '../../../shared/ipc/browser';
import type { BrowserViewState } from '../../../shared/ipc/desktop-api';
import { Icon, IconButton, Input } from '../../ui';

/** The page itself is a main-process WebContentsView; this renderer owns only controls and bounds. */
export function BrowserPanel() {
  const surface = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | undefined>(undefined);
  const committedURL = useRef('');
  const [id, setId] = useState<string>();
  const [address, setAddress] = useState('');
  const [state, setState] = useState<BrowserViewState>();
  const [error, setError] = useState('');

  const syncBounds = useCallback(() => {
    const viewId = idRef.current;
    const rect = surface.current?.getBoundingClientRect();
    if (!viewId || !rect) return;
    const bounds = rect.width > 0 && rect.height > 0 ? {
      x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height),
    } : null;
    void desktopClient.setBrowserViewBounds(viewId, bounds).catch(reason => setError(String(reason)));
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = desktopClient.onBrowserViewState(next => {
      if (active && next.id === idRef.current) {
        setState(next);
        if (next.url !== committedURL.current) { committedURL.current = next.url; setAddress(next.url); }
        setError(next.error ?? '');
      }
    });
    const observer = new ResizeObserver(syncBounds);
    if (surface.current) observer.observe(surface.current);
    const tabPanel = surface.current?.closest('[role="tabpanel"]');
    const visibilityObserver = tabPanel ? new MutationObserver(syncBounds) : undefined;
    if (tabPanel && visibilityObserver) visibilityObserver.observe(tabPanel, { attributes: true, attributeFilter: ['hidden'] });
    const onResize = () => syncBounds();
    window.addEventListener('resize', onResize);
    void desktopClient.createBrowserView().then(viewId => {
      if (!active) { try { void desktopClient.disposeBrowserView(viewId).catch(() => {}); } catch { /* The view may outlive a disconnected renderer. */ } return; }
      idRef.current = viewId; setId(viewId); syncBounds();
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => {
      active = false; observer.disconnect(); visibilityObserver?.disconnect(); window.removeEventListener('resize', onResize); unsubscribe();
      const viewId = idRef.current; idRef.current = undefined;
      if (viewId) { try { void desktopClient.disposeBrowserView(viewId).catch(() => {}); } catch { /* The view may outlive a disconnected renderer. */ } }
    };
  }, [syncBounds]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!id) return;
    const url = normalizeBrowserURL(address);
    if (!url) { setError('请输入 HTTPS 地址；本地开发服务可使用 localhost HTTP。'); return; }
    setAddress(url); setError('');
    void desktopClient.navigateBrowser(id, url).catch(reason => setError(String(reason)));
  };

  return <section className="workspace-browser" aria-label="Browser">
    <form className="workspace-browser-toolbar" onSubmit={submit}>
      <IconButton icon="back" label="后退" variant="ghost" disabled={!state?.canGoBack || !id} onClick={() => id && void desktopClient.goBackBrowser(id)}/>
      <IconButton icon="forward" label="前进" variant="ghost" disabled={!state?.canGoForward || !id} onClick={() => id && void desktopClient.goForwardBrowser(id)}/>
      <IconButton icon="refresh" label="重新加载" variant="ghost" disabled={!id || !state?.url} onClick={() => id && void desktopClient.reloadBrowser(id)}/>
      <label className="workspace-browser-address"><Icon name="browser"/><Input aria-label="浏览器地址" value={address} onChange={event => setAddress(event.currentTarget.value)} placeholder="输入网址或搜索" spellCheck={false}/></label>
      <button className="workspace-browser-go" type="submit" disabled={!id}>前往</button>
    </form>
    {error && <div className="workspace-browser-error" role="alert">{error}</div>}
    {state?.loading && <div className="workspace-browser-loading" role="status">正在加载…</div>}
    {!state?.url && !error && <div className="workspace-browser-empty"><Icon name="browser"/><span>输入网址以在隔离的浏览器视图中打开网页</span></div>}
    <div className="workspace-browser-surface" ref={surface} aria-label={state?.title || '网页内容'}/>
  </section>;
}

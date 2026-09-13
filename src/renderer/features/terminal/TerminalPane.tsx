import { desktopClient } from '../../app/desktop-client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { modifiedEnter } from './terminal-keys';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { terminalThemes, type ResolvedTheme } from './terminal-theme';

export interface TerminalHandle {
  focus(): void;
  paste(text: string): void;
  search(text: string, backwards?: boolean): boolean;
  clearSearch(): void;
}

interface Props {
  session: SessionInfo;
  active: boolean;
  fontSize: number;
  theme?: ResolvedTheme;
  platform: string;
  onReady(id: string, handle: TerminalHandle | null): void;
  onExit(id: string, code: number): void;
  onError(message: string): void;
}

export function TerminalPane({ session, active, fontSize, theme = 'light', platform, onReady, onExit, onError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const callbacks = useRef({ onExit, onError, onReady });
  callbacks.current = { onExit, onError, onReady };

  useEffect(() => {
    const id = session.id;
    const term = new Terminal({
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize, lineHeight: 1.22, cursorBlink: true, scrollback: 20000,
      allowProposedApi: true,
      linkHandler: { activate: (_event, url) => { void desktopClient.openExternal(url).catch(error => callbacks.current.onError(String(error))); } },
      theme: terminalThemes[theme],
    });
    terminal.current = term;
    const fitAddon = new FitAddon();
    const search = new SearchAddon();
    fit.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((event, url) => {
      event.preventDefault();
      void desktopClient.openExternal(url).catch(error => callbacks.current.onError(String(error)));
    }));
    term.loadAddon(new ImageAddon());
    term.open(container.current!);
    const refit = () => {
      if (container.current && container.current.clientWidth > 0 && container.current.clientHeight > 0) fitAddon.fit();
    };
    const observer = new ResizeObserver(refit);
    observer.observe(container.current!);
    refit();
    const disposables = [
      term.onData(data => desktopClient.write(id, data)),
      term.onResize(({ cols, rows }) => desktopClient.resize(id, cols, rows)),
    ];
    let alive = true;
    const unsubscribe = desktopClient.onSessionEvent(event => {
      if (event.id !== id) return;
      if (event.type === 'terminal-data') {
        term.write(event.data, () => { if (alive) desktopClient.acknowledge(id, event.data.length); });
      } else if (event.type === 'exit') {
        term.write(`\r\n\x1b[90m[Pi 进程已退出 · ${event.exitCode}]\x1b[0m\r\n`);
        callbacks.current.onExit(id, event.exitCode);
      }
    });
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || event.isComposing) return true;
      const copy = platform === 'darwin' ? event.metaKey && event.key.toLowerCase() === 'c' : event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'c';
      const paste = platform === 'darwin' ? event.metaKey && event.key.toLowerCase() === 'v' : event.ctrlKey && event.key.toLowerCase() === 'v';
      if (copy && term.hasSelection()) {
        event.preventDefault();
        void desktopClient.writeClipboard(term.getSelection()).catch(error => callbacks.current.onError(String(error)));
        return false;
      }
      if (paste) {
        event.preventDefault();
        void desktopClient.readClipboard().then(value => {
          if (!alive) return;
          if (value.image) desktopClient.write(id, platform === 'win32' ? '\x1bv' : '\x16');
          else term.paste(value.text);
        }).catch(error => callbacks.current.onError(String(error)));
        return false;
      }
      const sequence = modifiedEnter(event);
      if (sequence) { event.preventDefault(); desktopClient.write(id, sequence); return false; }
      return true;
    });
    callbacks.current.onReady(id, {
      focus: () => term.focus(),
      paste: value => { term.paste(value); term.focus(); },
      search: (value, backwards = false) => backwards ? search.findPrevious(value) : search.findNext(value),
      clearSearch: () => search.clearDecorations(),
    });
    // Attach the renderer before spawning: startup prompts/output must not race the subscription.
    void desktopClient.startSession(id).then(() => {
      if (alive) desktopClient.resize(id, term.cols, term.rows);
    }).catch(error => { callbacks.current.onError(String(error)); callbacks.current.onExit(id, 1); });
    return () => {
      alive = false;
      unsubscribe(); observer.disconnect(); disposables.forEach(item => item.dispose());
      callbacks.current.onReady(id, null);
      term.dispose(); terminal.current = null; fit.current = null;
    };
  }, [session.id]);

  useEffect(() => { if (terminal.current) terminal.current.options.theme = terminalThemes[theme]; }, [theme]);

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    if (active) { fit.current?.fit(); terminal.current.focus(); }
  }, [active, fontSize]);

  return <div className={`terminal-pane ${active ? 'active' : ''}`} aria-hidden={!active} ref={container} data-session-id={session.id} />;
}

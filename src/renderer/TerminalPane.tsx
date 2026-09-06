import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import '@xterm/xterm/css/xterm.css';
import { modifiedEnter } from './terminal-keys';
import type { SessionInfo } from '../shared/contracts';

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
  platform: string;
  onReady(id: string, handle: TerminalHandle | null): void;
  onExit(id: string, code: number): void;
  onError(message: string): void;
}

export function TerminalPane({ session, active, fontSize, platform, onReady, onExit, onError }: Props) {
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
      linkHandler: { activate: (_event, url) => { void window.desktop.openExternal(url).catch(error => callbacks.current.onError(String(error))); } },
      theme: { background: '#151619', foreground: '#d9dce3', cursor: '#eca777', selectionBackground: '#66504488', black: '#24262c', red: '#ed8585', green: '#99be94', yellow: '#e4bd7c', blue: '#8baee5', magenta: '#c9a0dc', cyan: '#8ac7c9', white: '#e5e7eb', brightBlack: '#7c8190' },
    });
    terminal.current = term;
    const fitAddon = new FitAddon();
    const search = new SearchAddon();
    fit.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((event, url) => {
      event.preventDefault();
      void window.desktop.openExternal(url).catch(error => callbacks.current.onError(String(error)));
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
      term.onData(data => window.desktop.write(id, data)),
      term.onResize(({ cols, rows }) => window.desktop.resize(id, cols, rows)),
    ];
    let alive = true;
    const unsubscribe = window.desktop.onSessionEvent(event => {
      if (event.id !== id) return;
      if (event.type === 'terminal-data') {
        term.write(event.data, () => { if (alive) window.desktop.acknowledge(id, event.data.length); });
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
        void window.desktop.writeClipboard(term.getSelection()).catch(error => callbacks.current.onError(String(error)));
        return false;
      }
      if (paste) {
        event.preventDefault();
        void window.desktop.readClipboard().then(value => {
          if (!alive) return;
          if (value.image) window.desktop.write(id, platform === 'win32' ? '\x1bv' : '\x16');
          else term.paste(value.text);
        }).catch(error => callbacks.current.onError(String(error)));
        return false;
      }
      const sequence = modifiedEnter(event);
      if (sequence) { event.preventDefault(); window.desktop.write(id, sequence); return false; }
      return true;
    });
    callbacks.current.onReady(id, {
      focus: () => term.focus(),
      paste: value => { term.paste(value); term.focus(); },
      search: (value, backwards = false) => backwards ? search.findPrevious(value) : search.findNext(value),
      clearSearch: () => search.clearDecorations(),
    });
    // Attach the renderer before spawning: startup prompts/output must not race the subscription.
    void window.desktop.startSession(id).then(() => {
      if (alive) window.desktop.resize(id, term.cols, term.rows);
    }).catch(error => { callbacks.current.onError(String(error)); callbacks.current.onExit(id, 1); });
    return () => {
      alive = false;
      unsubscribe(); observer.disconnect(); disposables.forEach(item => item.dispose());
      callbacks.current.onReady(id, null);
      term.dispose(); terminal.current = null; fit.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    if (active) { fit.current?.fit(); terminal.current.focus(); }
  }, [active, fontSize]);

  return <div className={`terminal-pane ${active ? 'active' : ''}`} aria-hidden={!active} ref={container} data-session-id={session.id} />;
}

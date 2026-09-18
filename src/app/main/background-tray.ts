import type { BrowserWindow, Menu as ElectronMenu, NativeImage, Tray } from 'electron';

type TrayConstructor = new (image: NativeImage) => Tray;

const trayIcon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="3" y="3" width="26" height="26" rx="7" fill="#6d5ce7"/><path d="M9 11h14v3H9zm0 6h10v3H9z" fill="white"/></svg>',
);

/** Creates the single-window tray surface; all process ownership stays with the lifecycle binder. */
export function createBackgroundTray({
  Tray,
  Menu,
  nativeImage,
  window,
  onQuit,
}: {
  Tray: TrayConstructor;
  Menu: Pick<typeof ElectronMenu, 'buildFromTemplate'>;
  nativeImage: Pick<typeof import('electron').nativeImage, 'createFromDataURL'>;
  window: BrowserWindow;
  onQuit: () => void;
}): Tray {
  const tray = new Tray(nativeImage.createFromDataURL(trayIcon));
  tray.setToolTip('PUA — Pi Universal App');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 PUA', click: () => { if (!window.isDestroyed()) window.show(); } },
    { type: 'separator' },
    { label: '退出并停止任务', click: onQuit },
  ]));
  tray.on('click', () => { if (!window.isDestroyed()) window.show(); });
  return tray;
}

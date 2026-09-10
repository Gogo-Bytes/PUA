import type { Menu as ElectronMenu, shell as ElectronShell } from 'electron';

export function installMenu({ Menu, shell, platform, diagnostics = false }: { Menu: Pick<typeof ElectronMenu, 'setApplicationMenu' | 'buildFromTemplate'>; shell: Pick<typeof ElectronShell, 'openExternal'>; platform: string; diagnostics?: boolean }): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(platform === 'darwin' ? [{ label: 'PUA', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    { label: '编辑', role: 'editMenu' },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }, { role: 'close' }, ...(diagnostics ? [{ type: 'separator' as const }, { label: '打开开发者工具', role: 'toggleDevTools' as const, accelerator: 'CommandOrControl+Alt+I' }] : [])] },
    { label: '帮助', submenu: [{ label: 'Pi 官方文档', click: () => { void shell.openExternal('https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent'); } }] },
  ]));
}

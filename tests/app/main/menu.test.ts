import { describe, expect, it, vi } from 'vitest';
import type { Menu as ElectronMenu, MenuItemConstructorOptions } from 'electron';
import { installMenu } from '../../../src/app/main/menu';

describe('installMenu platform templates (in-memory shell)', () => {
  it('exposes DevTools only when diagnostics is explicitly enabled', () => {
    for (const diagnostics of [false, true]) {
      let template: MenuItemConstructorOptions[] = [];
      const Menu = { buildFromTemplate: vi.fn((value: MenuItemConstructorOptions[]) => { template = value; return {} as ElectronMenu; }), setApplicationMenu: vi.fn() };
      const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
      installMenu({ Menu, shell, platform: 'darwin', diagnostics });
      const items = template.find(item => item.label === '窗口')!.submenu as MenuItemConstructorOptions[];
      expect(items.some(item => item.role === 'toggleDevTools')).toBe(diagnostics);
      expect(shell.openExternal).not.toHaveBeenCalled();
    }
  });
  it.each(['darwin', 'win32', 'linux'])('preserves %s roles and explicitly drives only Fake link callback', platform => {
    let template: MenuItemConstructorOptions[] = [];
    const built = {} as ElectronMenu;
    const Menu = { buildFromTemplate: vi.fn((value: MenuItemConstructorOptions[]) => { template = value; return built; }), setApplicationMenu: vi.fn() };
    const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    installMenu({ Menu, shell, platform });
    expect(Menu.setApplicationMenu).toHaveBeenCalledExactlyOnceWith(built);
    expect(template.map(item => item.label)).toEqual(platform === 'darwin' ? ['PUA', '编辑', '窗口', '帮助'] : ['编辑', '窗口', '帮助']);
    if (platform === 'darwin') expect(template[0].submenu).toEqual([{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]);
    expect(template.find(item => item.label === '窗口')!.submenu).toEqual([{ role: 'minimize' }, { role: 'togglefullscreen' }, { role: 'close' }]);
    const edit = template.find(item => item.label === '编辑')!;
    expect(edit.role).toBe('editMenu');
    expect(edit.submenu).toBeUndefined(); // Electron supplies native roles and focused-control shortcuts.
    expect(shell.openExternal).not.toHaveBeenCalled();
    const help = template.find(item => item.label === '帮助')!.submenu as MenuItemConstructorOptions[];
    (help[0].click as () => void)(); expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent');
  });
});

import type { ResolvedTheme } from '../../ui';

export type { ResolvedTheme };

// xterm renders outside CSS inheritance, so its palette is a static projection of
// the production semantic themes rather than a second theme preference owner.
export const terminalThemes = {
  light: {
    background: '#f6f7fa', foreground: '#4c4f69', cursor: '#4c4f69', selectionBackground: '#dce0e8',
    black: '#4c4f69', red: '#b52f45', green: '#237047', yellow: '#895b0b', blue: '#0b68cb', magenta: '#8839ef', cyan: '#266393', white: '#ccd0da',
    brightBlack: '#5e6276', brightRed: '#b52f45', brightGreen: '#237047', brightYellow: '#895b0b', brightBlue: '#0b68cb', brightMagenta: '#8839ef', brightCyan: '#266393', brightWhite: '#f6f7fa',
  },
  dark: {
    background: '#242436', foreground: '#cdd6f4', cursor: '#cdd6f4', selectionBackground: '#36364b',
    black: '#1e1e2e', red: '#ffa1b2', green: '#8fd5ad', yellow: '#efc571', blue: '#79b8ff', magenta: '#cba6f7', cyan: '#93c7f3', white: '#cdd6f4',
    brightBlack: '#a6adc8', brightRed: '#ffa1b2', brightGreen: '#8fd5ad', brightYellow: '#efc571', brightBlue: '#a8d1ff', brightMagenta: '#cba6f7', brightCyan: '#93c7f3', brightWhite: '#ffffff',
  },
} satisfies Record<ResolvedTheme, Record<string, string>>;

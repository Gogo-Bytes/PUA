const paths = {
  pi: 'M4 7h16M8 7 7 19M16 7v10c0 2 2 2 3 1',
  folder: 'M3 7V5h6l2 2h10v13H3Z',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  search: 'M16 16l5 5M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0',
  settings: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  chat: 'M4 4h16v13H9l-5 4ZM8 8h8M8 12h5',
  down: 'm6 9 6 6 6-6',
  chevron: 'm9 5 7 7-7 7',
  panel: 'M3 4h18v16H3ZM14 4v16',
  up: 'M12 19V5m-6 6 6-6 6 6',
  stop: 'M6 6h12v12H6Z',
  check: 'm5 12 4 4L19 6',
  file: 'M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6',
  code: 'm7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16',
  copy: 'M8 8h12v13H8ZM16 8V3H3v13h5',
  link: 'm10 14 4-4m-6 1-3 3a4 4 0 0 0 6 6l3-3m-4-10 3-3a4 4 0 0 1 6 6l-3 3',
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

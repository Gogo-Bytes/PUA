/** Valid desktop-shell values; parsing/compatibility belongs to the IPC and disk edges. */
export interface PreferenceValues {
  piPath: string;
  nodePath: string;
  args: string[];
  fontSize: number;
  recentProjects: string[];
  theme?: 'system' | 'light' | 'dark';
}

export interface PreferencesPersistencePort {
  /** May throw validation errors synchronously. Success confirms this write, not a current-state transaction. */
  write(values: PreferenceValues): Promise<void>;
}

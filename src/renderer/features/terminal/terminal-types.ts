export interface TerminalHandle {
  focus(): void;
  paste(text: string): void;
  search(text: string, backwards?: boolean): boolean;
  clearSearch(): void;
}

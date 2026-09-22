import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const merge = extendTailwindMerge({ prefix: 'tw' });
export function cn(...inputs: ClassValue[]) { return merge(clsx(inputs)); }

export const triggerClass = 'tw:inline-flex tw:h-7 tw:items-center tw:justify-between tw:gap-1.5 tw:rounded-md tw:px-2 tw:text-sm tw:text-muted-foreground tw:hover:bg-muted tw:focus-visible:outline-2 tw:focus-visible:outline-ring tw:focus-visible:outline-offset-2 tw:disabled:opacity-50';
export const popupClass = 'tw:overflow-y-auto tw:max-h-(--available-height) tw:max-w-(--available-width) tw:rounded-lg tw:border tw:border-solid tw:border-border tw:bg-popover tw:p-1 tw:text-sm tw:text-popover-foreground tw:shadow-md tw:outline-none';
export const itemClass = 'tw:relative tw:flex tw:min-h-7 tw:cursor-default tw:items-center tw:gap-2 tw:rounded-md tw:py-1 tw:pr-8 tw:pl-2 tw:outline-none tw:select-none tw:data-highlighted:bg-accent tw:data-disabled:opacity-50 tw:data-disabled:pointer-events-none';

// shadcn-style native field primitives. Native events/ref/IME stay intact.
import { forwardRef, type ComponentPropsWithRef } from 'react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from './shadcn-utils';

const fieldClass = 'tw:disabled:cursor-not-allowed tw:disabled:opacity-60 tw:focus-visible:outline-2 tw:focus-visible:outline-ring';
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithRef<'input'>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={cn('ui-input', fieldClass, className)}/>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithRef<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} {...props} className={cn('ui-input tw:resize-y', fieldClass, className)}/>;
});
/** Native grouped radios retain form semantics and browser arrow-key selection. */
export const Radio = forwardRef<HTMLInputElement, Omit<ComponentPropsWithRef<'input'>, 'type'>>(function Radio({ className, ...props }, ref) {
  return <input ref={ref} {...props} type="radio" className={cn('tw:accent-(--ui-accent) tw:size-4 tw:shrink-0', fieldClass, className)}/>;
});
export const Slider = forwardRef<HTMLInputElement, Omit<ComponentPropsWithRef<'input'>, 'type'>>(function Slider({ className, ...props }, ref) {
  return <input ref={ref} {...props} type="range" className={cn('tw:accent-(--ui-accent) tw:w-full', fieldClass, className)}/>;
});
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return <CheckboxPrimitive.Root {...props} className={cn('tw:flex tw:size-4 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-sm tw:border tw:border-solid tw:border-border tw:bg-background tw:text-foreground tw:data-checked:bg-accent tw:disabled:opacity-60', fieldClass, className)}>
    <CheckboxPrimitive.Indicator><Check size={12}/></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}

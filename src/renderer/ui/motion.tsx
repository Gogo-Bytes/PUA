import { useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { useMotionScale } from './theme';
gsap.registerPlugin(useGSAP);
export const motionTokens = { overlay: 0.16, structure: 0.24, ease: 'power2.out' } as const;
/** Owns presence and interruption; semantic closure is immediate, visual closure may finish later. */
export function Reveal({ open, children, axis = 'y' }: { open: boolean; children: ReactNode; axis?: 'x' | 'y' }) {
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const scale = useMotionScale();
  useGSAP(() => {
    gsap.set(root.current, { height: open ? 'auto' : 0 });
    gsap.set(content.current, { autoAlpha: open ? 1 : 0, [axis]: open ? 0 : -8 });
  }, { scope: root });
  useGSAP(context => {
    // kill(false) releases context history but keeps the current rendered styles.
    context.kill(false);
    const node = root.current!, inner = content.current!;
    if (!scale) {
      gsap.set(node, { height: open ? 'auto' : 0 });
      gsap.set(inner, { autoAlpha: open ? 1 : 0, [axis]: open ? 0 : -8 });
      node.hidden = !open;
      return;
    }
    node.hidden = false;
    const finish = () => { node.hidden = !open; };
    const tl = gsap.timeline({ defaults: { duration: motionTokens.structure * scale, ease: motionTokens.ease, overwrite: 'auto' }, onComplete: finish });
    tl.to(node, { height: open ? 'auto' : 0 }, 0)
      .to(inner, { autoAlpha: open ? 1 : 0, [axis]: open ? 0 : -8 }, 0);
  }, { dependencies: [open, scale, axis], scope: root });
  return <div ref={root} className="ui-reveal" inert={!open} aria-hidden={!open}><div ref={content}>{children}</div></div>;
}
export function MotionSample({ replay }: { replay: number }) {
  const root = useRef<HTMLDivElement>(null); const scale = useMotionScale();
  useGSAP(context => {
    const interrupted = context.getTweens().some((tween: gsap.core.Tween) => tween.progress() < 1);
    context.kill(false);
    if (!interrupted && scale) gsap.set(root.current, { y: 8, autoAlpha: 0 });
    gsap.to(root.current, { y: 0, autoAlpha: 1, duration: motionTokens.structure * scale, ease: motionTokens.ease, overwrite: 'auto' });
  }, { scope: root, dependencies: [replay, scale] });
  return <div ref={root} className="ui-motion-sample">Ready for your next idea <span>0.24s · power2.out</span></div>;
}
export { gsap, useGSAP };

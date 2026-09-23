/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRef } from 'react';
import '../../../component-preview/test-setup';
import type { SessionInfo } from '../../../../src/shared/ipc/desktop-api';
import { TerminalOutlet } from '../../../../src/renderer/features/terminal/TerminalOutlet';

vi.mock('../../../../src/renderer/features/terminal/TerminalPane', () => ({ TerminalPane: ({ session }: { session: SessionInfo }) => <div data-testid="single-pty" data-session={session.id}/> }));

const terminal: SessionInfo = { id: 'term-1', cwd: '/work', title: 'Shell', kind: 'terminal', processStatus: 'running', activity: 'idle' };

function Harness({ docked }: { docked: boolean }) {
  const stage = useRef<HTMLDivElement>(null); const dock = useRef<HTMLDivElement>(null);
  return <><div ref={stage} data-testid="stage"/><div ref={dock} data-testid="dock"/><TerminalOutlet sessions={[terminal]} activeId="term-1" platform="darwin" fontSize={14} theme="light" docked={docked} stageRef={stage} dockRef={dock} onReady={() => {}} onExit={() => {}} onError={() => {}}/></>;
}

it('repositions the same terminal pane between the workspace and right-side Terminal tab', () => {
  const { rerender } = render(<Harness docked={false}/>);
  const pane = screen.getByTestId('single-pty');
  const stage = screen.getByTestId('stage'); const dock = screen.getByTestId('dock');
  stage.getBoundingClientRect = () => ({ x: 10, y: 50, left: 10, top: 50, right: 510, bottom: 450, width: 500, height: 400, toJSON() {} });
  dock.getBoundingClientRect = () => ({ x: 700, y: 50, left: 700, top: 50, right: 1000, bottom: 450, width: 300, height: 400, toJSON() {} });
  window.dispatchEvent(new Event('resize'));
  const outlet = pane.parentElement!;
  expect(outlet.style.left).toBe('10px'); expect(outlet.style.width).toBe('500px');
  rerender(<Harness docked/>);
  expect(screen.getByTestId('single-pty')).toBe(pane);
  expect(outlet.style.left).toBe('700px'); expect(outlet.style.width).toBe('300px');
});

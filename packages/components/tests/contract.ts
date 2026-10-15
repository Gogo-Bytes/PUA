import type { SidebarSession, SidebarProject, SessionPresentation, SidebarProps } from '@pua/components';
const presentation: SessionPresentation = { execution: { state: 'working' }, attention: { kind: 'input' }, environment: { kind: 'remote' }, identity: { automation: 'run' } };
const sessions: readonly SidebarSession[] = [{ id: 's', title: 'Review', unread: true, presentation }];
const projects: readonly SidebarProject[] = [{ id: 'p', title: 'Docs', sessionIds: ['s'] }];
const props: SidebarProps = { sessions, projects, recentSessionIds: [], expandedProjectIds: ['p'] };
void props;
// @ts-expect-error Backend runtime decoding is not part of the formal Interface.
const raw: SessionPresentation = { ownedWork: true };
// @ts-expect-error Session unread is boolean, never a numeric counter.
const count: SidebarSession = { id: 's', title: 'Review', unread: 42 };
// @ts-expect-error Timestamp metadata belongs to the caller, not navigation.
const timestamp: SidebarSession = { id: 's', title: 'Review', updatedAtMs: 0 };
// @ts-expect-error Renderer plans are intentionally not public.
import type { SessionDisplay } from '@pua/components';
void raw; void count; void timestamp;
// @ts-expect-error Source branching/normalization helpers are study-only.
import { resolveSessionPresentation } from '@pua/components';
// @ts-expect-error Unused feedback knob is not part of standalone SessionRow.
const row: import('@pua/components').SessionRowProps = { session: sessions[0], feedback: false };
const header: import('@pua/components').ProjectRowProps = { project: { id: 'p', title: 'Docs' }, expanded: false };
void row; void header;

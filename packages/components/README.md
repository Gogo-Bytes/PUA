# @pua/components

Private **0.1.0** · React 19 / TypeScript / Base UI / Lucide / scoped CSS. A controlled navigation module for internal consumption, not a desktop application or backend integration. Independent Web approximation of observed interaction roles; no proprietary assets or original implementation are distributed.

## Consume

Build with `pnpm --filter @pua/components build`. Import only the package entry and CSS:

```tsx
import { useState } from 'react';
import { Sidebar, UIProvider, type SidebarProject, type SidebarSession } from '@pua/components';
import '@pua/components/styles.css';

const projects: readonly SidebarProject[] = [
  { id: 'project:docs', title: 'Documentation', sessionIds: ['session:review'] },
];
const sessions: readonly SidebarSession[] = [{
  id: 'session:review', title: 'Review onboarding', unread: true,
  presentation: {
    execution: { state: 'working' },
    attention: { kind: 'input' },
    environment: { kind: 'cloud' },
  },
}];
export function Navigation() {
  const [expanded, setExpanded] = useState<readonly string[]>(['project:docs']);
  const [selected, setSelected] = useState<string | null>(null);
  return <UIProvider theme="light"><div style={{ width: 320, height: 600 }}>
    <Sidebar projects={projects} sessions={sessions} recentSessionIds={[]}
      expandedProjectIds={expanded} selectedSessionId={selected}
      onProjectExpandedChange={(id, next) => setExpanded(ids => next ? [...new Set([...ids, id])] : ids.filter(value => value !== id))}
      onSelectSession={setSelected} />
  </div></UIProvider>;
}
```

See the repository's `apps/playground/src/Production.tsx` (`?view=production`) for a public-import-only consumption example with explicit owner command placeholders. `pnpm build && pnpm preview` exercises built package imports; `pnpm dev` uses explicit Vite aliases for source HMR. Consumers have no `development` export condition.

`UIProvider` supplies light/dark/system tokens and a local menu portal host. Import CSS once. It never mutates body theme/state. Override `--pua-*` tokens through provider style/className. Sidebar fills its parent; give that parent dimensions. ESM, CJS, declarations and CSS are the only distribution implementation artifacts.

## Interface and ownership

- Readonly caller data with explicit stable string IDs. Projects and sessions have separate ID namespaces. First duplicate entity wins; missing references are ignored; repeated IDs within each projection are deduplicated. One session may appear in multiple projects/recent. Ordering is never inferred or sorted.
- Caller owns selection, expansion, pin, boolean unread, menus/checked state, capabilities, semantic presentation, confirmation, persistence and business effects. No host/IPC/Electron/fs/Git/Pi dependencies. Missing callbacks omit/disable the corresponding capability; no fake handlers.
- `presentation.execution` is working/error (absence is idle). Error may have an explanatory label. `attention` is approval or input, with chip/pill presentation and optional normalized 0–1 progress; invalid progress clamps to zero. Pill suppresses the working/unread glyph in the same slot. Selection does not secretly reinterpret attention: the caller resolves selection-dependent business gates.
- `environment` is an optional non-local kind, explanatory label and starting animation. `identity` composes voice/live voice, automation, event, team and identity roles. `notice` is one informational dot with accessible label/tone; it does not classify subscription/runtime DTOs. Live voice takes precedence over the trailing execution/unread/pill glyph. Errors and identity/environment can coexist with unread. No completed/draft state is invented.
- Unread is boolean/dot, never a count. Error, status and identity/environment are right-only. No timestamp inputs or time rendering. `summary` is optional caller text in the right slot when no presentation is supplied.
- Rows are 31px. Project name/folder expands; opened folder remains a folder on hover. More/new-session do not expand. Default session status and hover/focus Pin/Archive/More replace each other in the same right slot. Scheduled input Snooze is a status interaction: targeting/focusing it keeps status visible and actions hidden. A menu already open keeps its action rail.
- `disabled`/`disabledReason` constrain UI, **not permissions/security**. Disabled sessions disable navigation/quick actions; callers omit canPin/primaryAction when those actions should be absent. `allowMenuWhenDisabled` can expose a management menu. Sidebar-wide disabled still wins. Loading preserves data but disables project/session actions, not search/commands/settings.
- Pin requires `canPin` plus callback and reports the next boolean. Primary action has caller ID/label and archive/close icon. More replaces quick Archive unless `retainArchiveAction`; Close remains. Menus are action/separator/recursive submenu, with optional checked/disabled reason/danger. Base UI handles keyboard navigation, submenus, Escape and focus restoration.

## Optional composition

`ProjectRow`, `SessionRow`, `ProjectMenu`, `SessionMenu`, `SessionActions` use the same contracts outside Sidebar. Standalone instances each have an isolated pending/error scope: composing several does **not** create a shared transaction registry. Use Sidebar when duplicate projections need coordinated locks. No resolver, renderer plan, indicator slots or normalization utilities are public.

## Async and lifecycle contract

Callbacks return `void | Promise<void>`; throw/reject means failure. Adapt other failure results into rejection. The module catches failures, shows a target-level alert, clears it on retry, never auto-retries, and does not optimistically mutate caller data. Pending buttons remain focusable via aria-disabled with a synchronous internal re-entry lock. External capability/disabled constraints still use native disabled.

Within one Sidebar, each session ID shares one mutation lane across all projections (Pin/menu/primary/Snooze). Each project shares mutation between menu/new-session. Navigation and expansion are separate lanes, so waiting on a mutation does not block selecting elsewhere. Lock acquisition precedes callback invocation.

A committed removal clears errors; readding an ID receives a new lifetime token. An outstanding old job retains the lock until settle but cannot write stale errors into the new lifetime. Unmount suppresses React updates; it **does not cancel business work**. Never-settling jobs stay pending. No guarantees across Sidebar/standalone instances, unobservable same-commit remove/readd, or multi-target transactions.

Caller owns cancellation, request version checks, stale business writes, permission checks, archive confirmation/removal, persistence and focus handoff after deleting a row. The view cannot safely infer a destination after removal. Pending does not imply execution state; presentation progress does not schedule deadlines.

## One-time migration from the study Interface

This private package has no external compatibility obligation; there is no legacy adapter in the package.

```tsx
// Before: presentation: { runtime: 'active', attention: { kind: 'input', source: 'userInputAsync' } }
// After:
const view = {
  execution: { state: 'working' }, attention: { kind: 'input' },
} satisfies import('@pua/components').SessionPresentation;
```

Resolve ownedWork/runtime/needsResume/latestTurn/publishing/entry in the caller. Resolve source hide/meta/float/priority gates before passing semantic data; filter archived sessions out of caller projections. Normalize source unread to boolean and prerequisites to environment presence. Subscription diagnostics, source priorities and raw decoder helpers live only in the playground's study adapter, never package exports. `statusLabel` becomes `summary`; remove timestamp metadata. Use the single shared `SidebarMenuItem` name instead of `ProjectMenuItem`. Standalone rows/menus always report their own errors; the unused public row `feedback` knob is removed. Standalone ProjectRow does not require sessionIds. Removed root exports: `resolveSessionPresentation`, `SessionIndicators`, `normalizeUnreadCount`, `normalizeProgress`, `formatSessionTime`, and renderer/source/time types. No dummy `leading=[]`/`floatStatus=false` required.

## Verification and limits

Repository tests require Node 22.22.2+ (22.x), 24.15+ (24.x), or ≥26 for jsdom 30; jsdom 28 was unsuitable because its computed styles did not reflect focus-within changes. These are development-only requirements, not package runtime dependencies.

`pnpm --filter @pua/components test` builds and runs package-owned Node test runner + jsdom/Testing Library tests, then type-level public contract checks, without the playground. jsdom provides semantic interaction coverage, not browser geometry/paint certification. Computed-style interaction tests guard rail exclusivity across focus, Snooze and open menus; native browser review remains required for actual hover/focus paint, touch and assistive technology. Lucide glyphs and CSS motion are approximations, honor reduced motion, and do not claim original SVG/timing fidelity. Research evidence and the 86-case source matrix remain repository-only and separate from this stable contract. Do not publish this private package without release authority.

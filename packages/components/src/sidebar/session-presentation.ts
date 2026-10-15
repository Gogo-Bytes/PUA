import type { SessionPresentation } from "./types";

// Private rendering plan. Callers provide semantic axes, never renderer slots.
export interface SessionBadge {
  kind:
    | "working"
    | "error"
    | "unread"
    | "input"
    | "voice-active"
    | "pin"
    | "custom"
    | "environment"
    | "automation"
    | "events"
    | "voice"
    | "team"
    | "identity";
  label: string;
  text?: string;
  tone?: "info" | "danger" | "green" | "purple" | "yellow" | "orange";
  progress?: number;
  pulsing?: boolean;
}
export interface SessionDisplay {
  chips: string[];
  badges: SessionBadge[];
  trailing: SessionBadge | null;
  labels: string[];
}
function progress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function resolveSessionPresentation(
  signal: SessionPresentation = {},
  context: { unread?: boolean; pinned?: boolean } = {},
): SessionDisplay {
  const badges: SessionBadge[] = [],
    chips: string[] = [];
  const { execution, attention, environment, identity, notice } = signal;
  if (execution?.state === "error")
    badges.push({
      kind: "error",
      label: execution.label ?? "Error",
      tone: "danger",
    });
  else if (!execution && context.pinned && !context.unread)
    badges.push({ kind: "pin", label: "Pinned" });
  if (environment)
    badges.push({
      kind: "environment",
      label:
        environment.label ??
        {
          remote: "Remote host",
          "remote-worktree": "Remote host · git worktree",
          worktree: "Local git worktree",
          cloud: "Cloud chat",
        }[environment.kind],
      text: environment.kind,
      pulsing: environment.starting,
    });
  if (identity?.kind)
    badges.push({
      kind: "identity",
      label:
        identity.kind === "aeon" ? "Aeon identity" : "Cloud environment setup",
      text: identity.kind,
    });
  if (identity?.automation)
    badges.push({
      kind: "automation",
      label:
        identity.automation === "run"
          ? "Scheduled task run"
          : "Scheduled task attached",
      text: identity.automation,
    });
  if (identity?.events)
    badges.push({ kind: "events", label: "Event subscriptions" });
  if (identity?.voice) badges.push({ kind: "voice", label: "Voice chat" });
  if (identity?.teamMembers?.length)
    badges.push({
      kind: "team",
      label: `Team: ${identity.teamMembers.join(", ")}`,
      text: identity.teamMembers
        .slice(0, 2)
        .map((name) => name.slice(0, 1))
        .join(""),
    });
  if (notice)
    badges.push({
      kind: "custom",
      label: notice.label,
      tone: notice.tone ?? "info",
    });
  if (attention?.kind === "approval") chips.push("Awaiting approval");
  else if (attention?.kind === "input" && attention.style !== "pill")
    chips.push("Needs input");
  let trailing: SessionBadge | null =
    execution?.state === "working"
      ? { kind: "working", label: execution.label ?? "Working" }
      : context.unread
        ? { kind: "unread", label: "Unread", tone: "info" }
        : null;
  if (attention?.kind === "input" && attention.style === "pill")
    trailing = {
      kind: "input",
      label: "Needs input",
      tone: "info",
      ...(attention.progress !== undefined
        ? { progress: progress(attention.progress) }
        : {}),
    };
  if (identity?.liveVoice)
    trailing = {
      kind: "voice-active",
      label: "Voice chat active",
      tone: "info",
      pulsing: true,
    };
  return {
    chips,
    badges,
    trailing,
    labels: [
      ...new Set([
        ...chips,
        ...badges.map((badge) => badge.label),
        ...(trailing ? [trailing.label] : []),
      ]),
    ],
  };
}

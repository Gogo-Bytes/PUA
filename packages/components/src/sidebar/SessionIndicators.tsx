import {
  AudioLines,
  Bell,
  CircleAlert,
  Cloud,
  GitBranch,
  Globe,
  LoaderCircle,
  Pin,
  Sparkles,
  Timer,
  Wrench,
} from "lucide-react";
import type { SessionBadge, SessionDisplay } from "./session-presentation";

/** Lucide silhouettes/CSS motion approximate the observed roles, not proprietary SVGs. */
export function SessionIndicators({
  display,
  onSnooze,
  snoozeDisabled,
}: {
  display: SessionDisplay;
  onSnooze?: () => void;
  snoozeDisabled?: boolean;
}) {
  const badges = [
    ...display.badges,
    ...(display.trailing ? [display.trailing] : []),
  ];
  return (
    <span className="pua-state-indicators">
      {display.chips.map((chip) => (
        <span key={chip} className="pua-state-chip" title={chip}>
          {chip}
        </span>
      ))}
      {badges.map((badge, index) => (
        <Badge
          key={`${badge.kind}:${index}`}
          badge={badge}
          onSnooze={onSnooze}
          snoozeDisabled={snoozeDisabled}
        />
      ))}
    </span>
  );
}
function Badge({
  badge,
  onSnooze,
  snoozeDisabled,
}: {
  badge: SessionBadge;
  onSnooze?: () => void;
  snoozeDisabled?: boolean;
}) {
  if (badge.kind === "input")
    return (
      <span className="pua-state-input" data-badge="input" title={badge.label}>
        {badge.progress !== undefined && (
          <span
            className="pua-state-input-fill"
            aria-hidden="true"
            style={{ width: `${badge.progress * 100}%` }}
          />
        )}
        <span>Needs input</span>
        {onSnooze && badge.progress !== undefined && (
          <button
            type="button"
            className="pua-state-snooze"
            aria-label="Snooze"
            aria-disabled={snoozeDisabled || undefined}
            onClick={() => {
              if (!snoozeDisabled) onSnooze();
            }}
          >
            Snooze
          </button>
        )}
      </span>
    );
  if (["unread", "voice-active", "custom"].includes(badge.kind))
    return (
      <span
        className="pua-state-dot-wrap"
        data-badge={badge.kind}
        role="img"
        aria-label={badge.label}
        title={badge.label}
      >
        <span
          className="pua-state-dot"
          data-tone={badge.tone}
          data-pulse={badge.pulsing || undefined}
        />
      </span>
    );
  if (badge.kind === "team")
    return (
      <span
        className="pua-state-team"
        data-badge="team"
        role="img"
        aria-label={badge.label}
        title={badge.label}
      >
        {badge.text}
      </span>
    );
  const Icon =
    badge.kind === "working"
      ? LoaderCircle
      : badge.kind === "error"
        ? CircleAlert
        : badge.kind === "pin"
          ? Pin
          : badge.kind === "automation"
            ? Timer
            : badge.kind === "events"
              ? Bell
              : badge.kind === "voice"
                ? AudioLines
                : badge.kind === "identity"
                  ? badge.text === "aeon"
                    ? Sparkles
                    : Wrench
                  : badge.text === "cloud"
                    ? Cloud
                    : badge.text === "worktree"
                      ? GitBranch
                      : Globe;
  return (
    <span
      className="pua-state-icon"
      data-badge={badge.kind}
      data-tone={badge.tone}
      data-pulse={badge.pulsing || undefined}
      role={badge.kind === "working" ? "status" : "img"}
      aria-label={badge.label}
      title={badge.label}
    >
      <Icon
        size={14}
        aria-hidden="true"
        className={badge.kind === "working" ? "pua-state-spinner" : undefined}
      />
      {badge.text === "remote-worktree" && (
        <GitBranch size={11} aria-hidden="true" />
      )}
    </span>
  );
}

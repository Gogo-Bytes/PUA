import { Archive, Pin, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { RowMenu } from "./ProjectMenu";
import { actionKey, EnsureActionScope, useActions } from "./actions";
import { ActionButton, Feedback } from "./shared";
import type { SidebarSession } from "./types";
import { resolveSessionPresentation } from "./session-presentation";
import { SessionIndicators } from "./SessionIndicators";

export interface SessionActionsProps {
  session: SidebarSession;
  disabled?: boolean;
  onPin?: (nextPinned: boolean) => void | Promise<void>;
  onPrimaryAction?: (actionId: string) => void | Promise<void>;
  onMenuAction?: (actionId: string) => void | Promise<void>;
}

function visibleActions({
  session,
  onPin,
  onMenuAction,
  onPrimaryAction,
}: SessionActionsProps) {
  const menu = !!(session.menu?.length && onMenuAction);
  return {
    menu,
    pin: !!(session.canPin && onPin),
    primary: !!(
      session.primaryAction &&
      onPrimaryAction &&
      (session.primaryAction.kind !== "archive" ||
        !menu ||
        session.retainArchiveAction)
    ),
  };
}

/** Source-traced hover rail: optional More, Pin, then caller-labelled Archive/Close. */
export function SessionActions(props: SessionActionsProps) {
  return (
    <EnsureActionScope target={actionKey("session", props.session.id)}>
      <SessionActionsContent {...props} />
    </EnsureActionScope>
  );
}
function SessionActionsContent({
  session,
  disabled,
  feedback = true,
  onPin,
  onPrimaryAction,
  onMenuAction,
}: SessionActionsProps & { feedback?: boolean }) {
  const target = actionKey("session", session.id);
  const actions = useActions();
  const blocked = disabled || session.disabled || !!session.disabledReason;
  const pending = actions.pending(target);
  const primary = session.primaryAction;
  const visible = visibleActions({
    session,
    onPin,
    onMenuAction,
    onPrimaryAction,
  });
  return (
    <>
      <span className="pua-session-actions">
        {visible.menu && session.menu && onMenuAction && (
          <RowMenu
            target={actionKey("session", session.id)}
            label={`${session.title} 更多操作`}
            items={session.menu}
            disabled={
              disabled ||
              (!session.allowMenuWhenDisabled &&
                !!(session.disabled || session.disabledReason))
            }
            onAction={onMenuAction}
            feedback={false}
          />
        )}
        {visible.pin && onPin && (
          <ActionButton
            label={`${session.pinned ? "取消置顶" : "置顶"} ${session.title}`}
            aria-pressed={!!session.pinned}
            disabled={blocked}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => {
              const next = !session.pinned;
              void actions.run(target, next ? "置顶" : "取消置顶", () =>
                onPin(next),
              );
            }}
          >
            <Pin size={15} aria-hidden="true" />
          </ActionButton>
        )}
        {visible.primary && primary && onPrimaryAction && (
          <ActionButton
            label={`${primary.label} ${session.title}`}
            title={primary.disabledReason ?? primary.label}
            disabled={blocked || primary.disabled || !!primary.disabledReason}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={() => {
              void actions.run(target, primary.label, () =>
                onPrimaryAction(primary.id),
              );
            }}
          >
            {primary.kind === "archive" ? (
              <Archive size={15} aria-hidden="true" />
            ) : (
              <X size={15} aria-hidden="true" />
            )}
          </ActionButton>
        )}
      </span>
      {feedback && <Feedback target={target} />}
    </>
  );
}

export interface SessionRowProps extends SessionActionsProps {
  selected?: boolean;
  nested?: boolean;
  onSelect?: () => void | Promise<void>;
  onSnooze?: () => void | Promise<void>;
}
export function SessionRow(props: SessionRowProps) {
  return (
    <EnsureActionScope target={actionKey("session", props.session.id)}>
      <SessionRowContent {...props} />
    </EnsureActionScope>
  );
}
function SessionRowContent({
  session,
  selected,
  nested,
  disabled,
  onSelect,
  onPin,
  onPrimaryAction,
  onMenuAction,
  onSnooze,
}: SessionRowProps) {
  const target = actionKey("session", session.id);
  const actions = useActions();
  const blocked = disabled || session.disabled || !!session.disabledReason;
  const visible = visibleActions({
    session,
    onPin,
    onMenuAction,
    onPrimaryAction,
  });
  const actionCount =
    Number(visible.menu) + Number(visible.pin) + Number(visible.primary);
  const hasActions = actionCount > 0;
  const display = session.presentation
    ? resolveSessionPresentation(session.presentation, {
        unread: session.unread,
        pinned: session.pinned,
      })
    : null;
  const [statusInteraction, setStatusInteraction] = useState(false);
  const snoozable = !!(
    onSnooze &&
    display?.trailing?.kind === "input" &&
    display.trailing.progress !== undefined
  );
  const description = [
    ...new Set(
      [
        session.disabledReason,
        ...(display
          ? display.labels
          : [
              session.summary,
              session.unread && "未读",
              session.pinned && "已置顶",
            ]),
      ].filter(Boolean),
    ),
  ].join(" · ");
  const snooze = onSnooze
    ? () => {
        if (!blocked) void actions.run(target, "Snooze", onSnooze);
      }
    : undefined;
  return (
    <div
      className={`pua-session ${nested ? "is-nested" : ""}`}
      data-session-id={session.id}
    >
      <div
        className="pua-row"
        data-selected={selected || undefined}
        data-has-actions={hasActions || undefined}
        data-status-interaction={(snoozable && statusInteraction) || undefined}
        onMouseEnter={(event) =>
          setStatusInteraction(
            snoozable &&
              event.target instanceof Element &&
              !!event.target.closest(".pua-session-meta"),
          )
        }
        onMouseMove={
          snoozable
            ? (event) =>
                setStatusInteraction(
                  event.target instanceof Element &&
                    !!event.target.closest(".pua-session-meta"),
                )
            : undefined
        }
        onMouseLeave={(event) =>
          setStatusInteraction(
            !!event.currentTarget.querySelector(".pua-state-snooze:focus"),
          )
        }
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setStatusInteraction(false);
        }}
        onFocusCapture={(event) =>
          setStatusInteraction(
            snoozable && event.target.classList.contains("pua-state-snooze"),
          )
        }
        data-pending={actions.pending(target) || undefined}
        aria-busy={!!actions.label(target)}
        style={
          {
            "--pua-action-width": `${actionCount * 24 + Math.max(0, actionCount - 1) * 3}px`,
          } as CSSProperties
        }
      >
        <button
          type="button"
          className="pua-row-label"
          aria-current={selected ? "page" : undefined}
          aria-label={`${session.title}${description ? ` · ${description}` : ""}`}
          title={`${session.title}${description ? ` · ${description}` : ""}`}
          disabled={blocked || !onSelect}
          aria-busy={actions.pending(target, "navigation") || undefined}
          onClick={() => {
            if (onSelect)
              void actions.run(target, "选择会话", onSelect, "navigation");
          }}
        >
          <span>{session.title}</span>
        </button>
        <span className="pua-session-meta">
          {display ? (
            <SessionIndicators
              display={display}
              onSnooze={snooze}
              snoozeDisabled={!!blocked || actions.pending(target)}
            />
          ) : (
            <>
              {session.summary && (
                <span className="pua-session-status">{session.summary}</span>
              )}
              {session.pinned && <Pin size={13} aria-label="已置顶" />}
              {session.unread && (
                <span className="pua-unread" role="img" aria-label="未读" />
              )}
            </>
          )}
        </span>
        {hasActions && (
          <SessionActionsContent
            session={session}
            disabled={disabled}
            onPin={onPin}
            onPrimaryAction={onPrimaryAction}
            onMenuAction={onMenuAction}
            feedback={false}
          />
        )}
      </div>
      <Feedback target={target} />
    </div>
  );
}

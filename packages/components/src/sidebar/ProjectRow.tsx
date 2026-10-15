import { Pin, SquarePen } from "lucide-react";
import { actionKey, EnsureActionScope, useActions } from "./actions";
import { RowMenu } from "./ProjectMenu";
import { ActionButton, Feedback, FolderDisclosure } from "./shared";
import type { SidebarCallback, SidebarProject } from "./types";

export interface ProjectRowProps {
  project: Omit<SidebarProject, "sessionIds">;
  expanded: boolean;
  selected?: boolean;
  disabled?: boolean;
  controls?: string;
  onExpandedChange?: (expanded: boolean) => void | Promise<void>;
  onSelect?: SidebarCallback;
  onNewSession?: SidebarCallback;
  onAction?: (actionId: string) => void | Promise<void>;
}
export function ProjectRow(props: ProjectRowProps) {
  return (
    <EnsureActionScope target={actionKey("project", props.project.id)}>
      <ProjectRowContent {...props} />
    </EnsureActionScope>
  );
}
function ProjectRowContent({
  project,
  expanded,
  selected,
  disabled,
  controls,
  onExpandedChange,
  onSelect,
  onNewSession,
  onAction,
}: ProjectRowProps) {
  const target = actionKey("project", project.id);
  const actions = useActions();
  const blocked = disabled || project.disabled || !!project.disabledReason;
  function toggleExpanded() {
    if (onExpandedChange)
      void actions.run(
        target,
        expanded ? "折叠项目" : "展开项目",
        () => onExpandedChange(!expanded),
        "expansion",
      );
  }
  return (
    <>
      <div
        className="pua-row pua-project-row"
        data-project-id={project.id}
        data-selected={selected || undefined}
        data-pending={actions.pending(target) || undefined}
        aria-busy={!!actions.label(target)}
      >
        <ActionButton
          label={`${expanded ? "折叠" : "展开"} ${project.title}`}
          className="pua-disclosure"
          title={project.disabledReason ?? project.title}
          aria-expanded={expanded}
          aria-controls={controls}
          disabled={blocked || !onExpandedChange}
          aria-busy={actions.pending(target, "expansion") || undefined}
          onClick={toggleExpanded}
        >
          <FolderDisclosure expanded={expanded} />
        </ActionButton>
        <button
          type="button"
          className="pua-row-label"
          aria-current={selected ? "page" : undefined}
          title={project.disabledReason ?? project.title}
          disabled={blocked || (!onSelect && !onExpandedChange)}
          aria-expanded={onExpandedChange ? expanded : undefined}
          aria-controls={onExpandedChange ? controls : undefined}
          aria-busy={
            actions.pending(target, "navigation") ||
            actions.pending(target, "expansion") ||
            undefined
          }
          onClick={() => {
            toggleExpanded();
            if (onSelect)
              void actions.run(target, "选择项目", onSelect, "navigation");
          }}
        >
          <span>{project.title}</span>
          {project.pinned && <Pin size={12} aria-label="已置顶" />}
        </button>
        <span className="pua-project-actions">
          {!!project.menu?.length && onAction && (
            <RowMenu
              target={target}
              label={`${project.title} 更多操作`}
              items={project.menu}
              disabled={blocked}
              onAction={onAction}
              feedback={false}
            />
          )}
          {onNewSession && (
            <ActionButton
              label={`在 ${project.title} 中新建会话`}
              disabled={blocked}
              aria-disabled={actions.pending(target) || undefined}
              aria-busy={actions.pending(target) || undefined}
              onClick={() => {
                void actions.run(target, "新建会话", onNewSession);
              }}
            >
              <SquarePen size={16} aria-hidden="true" />
            </ActionButton>
          )}
        </span>
      </div>
      <Feedback target={target} />
    </>
  );
}

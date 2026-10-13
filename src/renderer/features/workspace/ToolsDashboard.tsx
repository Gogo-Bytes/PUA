import { Button, Icon } from '../../ui';

export const panelTools = [
  { id: 'terminal', label: '终端', icon: 'terminal' },
  { id: 'browser', label: '浏览器', icon: 'browser' },
  { id: 'review', label: 'Git Diff', icon: 'review' },
] as const;
type PanelTool = (typeof panelTools)[number]['id'];

export function ToolsDashboard({ onOpen, canOpen }: {
  onOpen(kind: PanelTool): void;
  canOpen(kind: PanelTool): boolean;
}) {
  return (
    <div className="codex-tools-dashboard">
      <h3 className="codex-dashboard-title">工具</h3>
      <div className="codex-tools-grid">
        {panelTools.map(tool => (
          <Button key={tool.id} className="codex-tool-card" variant="ghost" disabled={!canOpen(tool.id)} onClick={() => onOpen(tool.id)}>
            <Icon name={tool.icon} />
            <span className="codex-tool-title">{tool.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

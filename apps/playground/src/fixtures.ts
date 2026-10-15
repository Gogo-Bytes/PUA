import type { SidebarMenuItem, SidebarProject, SidebarSession } from '@pua/components';

export interface DemoProject extends SidebarProject { section: string; worktree?: boolean }
export function createSeed() {
  const chat = (id: string, title: string, extra: Partial<SidebarSession> = {}): SidebarSession => ({
    id, title, canPin: true,
    primaryAction: { id: 'archive', label: '归档聊天', kind: 'archive' }, ...extra,
  });
  const sessions = [
    chat('pet-control', '评审桌面端控制台体验', { unread: true }),
    chat('pua-render', '修复渲染界面问题', { pinned: true }),
    chat('pua-menu', '优化左侧项目菜单栏'),
    { id: 'pua-terminal', title: '本地终端', summary: '运行中', primaryAction: { id: 'close', label: '关闭终端', kind: 'close' } } satisfies SidebarSession,
    chat('recent-ai', '分析 AI 工程建设改进方向'),
    chat('recent-requirements', '分析需求内容'),
    chat('recent-site', '我需要为官网项目做一个新的网站'),
    chat('recent-demo', '试玩 demo 玩法分析'),
  ];
  const projects: DemoProject[] = [
    { id: 'agent-pet', title: 'agent-pet', sessionIds: ['pet-control'], section: 'work' },
    { id: 'site-migration', title: '官网迁移治理', sessionIds: [], section: 'work' },
    { id: 'wish-tree', title: 'wish tree', sessionIds: [], section: 'personal' },
    { id: 'web-icons', title: 'web-icons', sessionIds: [], section: 'work' },
    { id: 'pua', title: 'PUA', sessionIds: ['pua-render', 'pua-menu', 'pua-terminal'], section: 'work', worktree: true },
    { id: 'agent-bot', title: '官网 agent bot', sessionIds: [], section: 'work' },
    { id: 'website-client', title: 'website-client', sessionIds: [], section: 'work' },
    { id: 'engineering', title: 'engineering-team', sessionIds: [], section: 'work' },
  ];
  return { projects, sessions, recent: ['recent-ai', 'recent-requirements', 'recent-site', 'recent-demo'] };
}

/** Demonstration adapter: conditions belong here, not inside the component package. */
export function projectMenu(project: DemoProject, sessions: readonly SidebarSession[]): SidebarMenuItem[] {
  const children = sessions.filter(session => project.sessionIds.includes(session.id));
  const chats = children.filter(session => session.primaryAction?.kind === 'archive');
  const items: SidebarMenuItem[] = [
    { type: 'action', id: 'pin', label: project.pinned ? '取消置顶' : '置顶项目', icon: 'pin' },
    { type: 'action', id: 'edit', label: '编辑项目', icon: 'edit' },
    { type: 'separator', id: 'organization' },
    { type: 'submenu', id: 'section', label: '分区', icon: 'folder', items: [
      { type: 'action', id: 'section:work', label: '工作', checked: project.section === 'work' },
      { type: 'action', id: 'section:personal', label: '个人', checked: project.section === 'personal' },
      { type: 'separator', id: 'section-creation' },
      { type: 'action', id: 'new-section', label: '新建分区…', icon: 'plus' },
    ] },
    { type: 'action', id: 'reveal', label: '在 Finder 中显示', icon: 'reveal' },
  ];
  if (project.worktree) items.push({ type: 'action', id: 'worktree', label: '在工作树中新建聊天', icon: 'plus' });
  items.push({ type: 'separator', id: 'sessions' });
  if (children.some(session => session.unread)) items.push({ type: 'action', id: 'read', label: '全部标为已读', icon: 'read' });
  items.push(
    { type: 'action', id: 'archive', label: '归档聊天', icon: 'archive', disabledReason: chats.length ? undefined : '项目中没有可归档的聊天' },
    { type: 'separator', id: 'removal' },
    { type: 'action', id: 'remove', label: '移除项目', icon: 'trash', danger: true },
  );
  return items;
}

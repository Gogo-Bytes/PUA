import type { ChatCommand } from '../../../shared/ipc/conversation';

/**
 * Keep the Codex-style @ affordance in the editor while speaking Pi's native
 * skill command protocol on the wire. Pi only expands a skill when the
 * submitted text starts with `/skill:<name>`; arbitrary @mentions and paths
 * must remain untouched.
 */
export function expandSkillReference(text: string, commands: readonly ChatCommand[]): string {
  const skills = new Set(commands.filter(command => command.source === 'skill').map(command => command.name.replace(/^skill:/, '')));
  const match = text.match(/^(\s*)@([^\s]+)/);
  if (!match || !skills.has(match[2])) return text;
  return `${match[1]}/skill:${match[2]}${text.slice(match[0].length)}`;
}

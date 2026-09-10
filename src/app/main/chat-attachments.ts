import type { ConversationApplication } from '../../modules/conversation/index.js';
import type { SessionProcessAdapter } from '../../main/session-process-adapter.js';
import { conversationError } from '../../main/conversation-mapper.js';
import type { ChatAttachment } from '../../shared/chat.js';

/** Staged sources transfer to Conversation on every outcome; display retains the existing path DTO. */
export async function registerChatAttachments(
  conversation: Pick<ConversationApplication, 'registerAttachments'>,
  adapter: Pick<SessionProcessAdapter, 'stageSources' | 'attachmentView'>,
  id: string,
  paths: string[],
): Promise<ChatAttachment[]> {
  try {
    const sources = adapter.stageSources(id, paths);
    const attachments = await conversation.registerAttachments(id, sources);
    return attachments.map(item => adapter.attachmentView(id, item));
  } catch (error) { return conversationError(error); }
}

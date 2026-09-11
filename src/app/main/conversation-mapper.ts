import { DesktopApplicationError } from './application-error.js';
import { ConversationFailure, type ConversationFailureCode, type ExtensionResponse, type SendIntent } from '../../modules/conversation/index.js';
import type { ChatDelivery, ExtensionUIResponse } from '../../shared/ipc/conversation.js';

const messages: Record<ConversationFailureCode, string> = {
  CLOSED: '会话已关闭',
  INVALID_DELIVERY: '无效发送方式',
  EMPTY_MESSAGE: '消息不能为空',
  INVALID_ATTACHMENTS: '无效附件列表',
  ATTACHMENT_EXPIRED: '附件已失效，请重新选择',
  SEND_PENDING: '上一条消息尚未确认，请稍候',
  TOO_MANY_ATTACHMENTS: '单次消息最多添加 20 个文件引用',
  TOO_MANY_IMAGES: '图片最多 4 张',
  IMAGE_TOO_LARGE: '超过 5 MiB',
  IMAGES_TOO_LARGE: '图片总大小超过 10 MiB',
};

export function conversationError(error: unknown): never {
  if (error instanceof ConversationFailure) {
    throw new DesktopApplicationError(error.code, `${error.attachmentName === undefined ? '' : `${error.attachmentName} `}${messages[error.code]}`);
  }
  throw error;
}

export function sendIntent(text: string, attachmentIds: string[], delivery: ChatDelivery): SendIntent {
  return { text, attachmentIds: [...attachmentIds], delivery };
}

export function extensionResponse(response: ExtensionUIResponse): ExtensionResponse {
  if ('cancelled' in response) return { id: response.id, cancelled: true };
  if ('confirmed' in response) return { id: response.id, confirmed: response.confirmed };
  return { id: response.id, value: response.value };
}

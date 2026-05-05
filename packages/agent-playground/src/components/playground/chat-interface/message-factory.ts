import { ASSISTANT_ERROR_MESSAGE } from './constants';
import type { IChatPanelMessage, TChatPanelMessageRole, TChatPanelMessageStatus } from './types';

interface ICreateChatPanelMessageInput {
  role: TChatPanelMessageRole;
  content: string;
  status?: TChatPanelMessageStatus;
  idOffset?: number;
}

function createChatPanelMessage({
  role,
  content,
  status,
  idOffset = 0,
}: ICreateChatPanelMessageInput): IChatPanelMessage {
  return {
    id: (Date.now() + idOffset).toString(),
    role,
    content,
    timestamp: new Date(),
    status,
  };
}

export function createUserMessage(content: string): IChatPanelMessage {
  return createChatPanelMessage({ role: 'user', content, status: 'sent' });
}

export function createAssistantMessage(content: string): IChatPanelMessage {
  return createChatPanelMessage({ role: 'assistant', content, status: 'sent', idOffset: 1 });
}

export function createAssistantErrorMessage(): IChatPanelMessage {
  return createChatPanelMessage({
    role: 'assistant',
    content: ASSISTANT_ERROR_MESSAGE,
    status: 'error',
    idOffset: 1,
  });
}

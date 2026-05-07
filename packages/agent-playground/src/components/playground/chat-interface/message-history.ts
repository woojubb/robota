import type { IChatPanelMessage } from './types';

export function findLastUserMessage(messages: IChatPanelMessage[]): IChatPanelMessage | undefined {
  return messages
    .slice()
    .reverse()
    .find((message) => message.role === 'user');
}

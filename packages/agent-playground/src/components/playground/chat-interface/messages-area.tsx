import { ScrollArea } from '../../ui/scroll-area';
import { EmptyChatState } from './empty-chat-state';
import { LoadingMessage } from './loading-message';
import { MessageCard } from './message-card';
import type { IChatPanelMessage } from './types';

interface IMessagesAreaProps {
  messages: IChatPanelMessage[];
  isAgentReady: boolean;
  isLoading: boolean;
  copiedId: string | null;
  onCopyMessage: (text: string, messageId: string) => void;
}

export function MessagesArea({
  messages,
  isAgentReady,
  isLoading,
  copiedId,
  onCopyMessage,
}: IMessagesAreaProps) {
  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4">
        {messages.length === 0 ? (
          <EmptyChatState isAgentReady={isAgentReady} />
        ) : (
          messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              isCopied={copiedId === message.id}
              onCopy={onCopyMessage}
            />
          ))
        )}

        {isLoading && <LoadingMessage />}
      </div>
    </ScrollArea>
  );
}

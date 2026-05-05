import { MessageSquare, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '../../ui/button';
import { ChatStatusBadge } from './chat-status-badge';

interface IChatHeaderProps {
  isAgentReady: boolean;
  hasMessages: boolean;
  onRetryLastMessage: () => void;
  onClearChat: () => void;
}

export function ChatHeader({
  isAgentReady,
  hasMessages,
  onRetryLastMessage,
  onClearChat,
}: IChatHeaderProps) {
  return (
    <div className="border-b p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Chat with Agent</h2>
          <ChatStatusBadge isAgentReady={isAgentReady} />
        </div>

        {hasMessages && (
          <div className="flex items-center space-x-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetryLastMessage}
              title="Retry last message"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearChat} title="Clear chat">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

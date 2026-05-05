import { Bot, Check, Copy, User } from 'lucide-react';

import { Avatar, AvatarFallback } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Card, CardContent } from '../../ui/card';
import type { IChatPanelMessage } from './types';

interface IMessageCardProps {
  message: IChatPanelMessage;
  isCopied: boolean;
  onCopy: (text: string, messageId: string) => void;
}

export function MessageCard({ message, isCopied, onCopy }: IMessageCardProps) {
  const isUserMessage = message.role === 'user';

  return (
    <div className="group">
      <Card
        className={`max-w-[85%] ${
          isUserMessage ? 'ml-auto bg-primary text-primary-foreground' : 'mr-auto'
        }`}
      >
        <CardContent className="p-3">
          <div className="flex items-start space-x-2">
            <Avatar className="h-6 w-6 mt-0.5">
              <AvatarFallback className="text-xs">
                {isUserMessage ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs opacity-70">{message.timestamp.toLocaleTimeString()}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onCopy(message.content, message.id)}
                >
                  {isCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Bot } from 'lucide-react';

import { Badge } from '../../ui/badge';

interface IChatStatusBadgeProps {
  isAgentReady: boolean;
}

export function ChatStatusBadge({ isAgentReady }: IChatStatusBadgeProps) {
  return (
    <Badge variant={isAgentReady ? 'default' : 'secondary'}>
      {isAgentReady ? (
        <>
          <Bot className="h-3 w-3 mr-1" />
          Ready
        </>
      ) : (
        'Not Ready'
      )}
    </Badge>
  );
}

import { Bot, Loader2 } from 'lucide-react';

import { Avatar, AvatarFallback } from '../../ui/avatar';
import { Card, CardContent } from '../../ui/card';

export function LoadingMessage() {
  return (
    <div className="max-w-[85%] mr-auto">
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center space-x-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs">
                <Bot className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Agent is thinking...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

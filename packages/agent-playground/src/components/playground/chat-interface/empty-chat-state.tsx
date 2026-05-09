import { MessageSquare } from 'lucide-react';

interface IEmptyChatStateProps {
  isAgentReady: boolean;
}

export function EmptyChatState({ isAgentReady }: IEmptyChatStateProps) {
  return (
    <div className="text-center text-muted-foreground py-12">
      <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p className="text-lg font-medium mb-2">Start a conversation</p>
      <p className="text-sm">
        {isAgentReady
          ? 'Your agent is ready! Type a message below to get started.'
          : 'Create an agent first using the "Create Agent" button.'}
      </p>
    </div>
  );
}

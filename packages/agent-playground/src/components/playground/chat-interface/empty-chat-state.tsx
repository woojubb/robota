import { MessageSquare } from 'lucide-react';

interface IEmptyChatStateProps {
  isAgentReady: boolean;
  starterPrompts?: string[];
  onSelectStarterPrompt?: (prompt: string) => void;
}

export function EmptyChatState({
  isAgentReady,
  starterPrompts,
  onSelectStarterPrompt,
}: IEmptyChatStateProps) {
  return (
    <div className="text-center text-muted-foreground py-12">
      <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p className="text-lg font-medium mb-2">Start a conversation</p>
      <p className="text-sm mb-4">
        {isAgentReady
          ? 'Your agent is ready! Type a message below to get started.'
          : 'Create an agent first using the "Create Agent" button.'}
      </p>
      {isAgentReady && starterPrompts && starterPrompts.length > 0 && (
        <div className="flex flex-col gap-2 items-center mt-2">
          {starterPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSelectStarterPrompt?.(prompt)}
              className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary hover:text-primary transition-colors text-left max-w-xs truncate"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

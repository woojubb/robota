import type { KeyboardEvent, RefObject } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '../../ui/button';
import { ChatInputHint } from './chat-input-hint';

interface IChatInputAreaProps {
  input: string;
  inputRef: RefObject<HTMLInputElement | null>;
  isAgentReady: boolean;
  isLoading: boolean;
  onInputChange: (input: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => Promise<void>;
}

export function ChatInputArea({
  input,
  inputRef,
  isAgentReady,
  isLoading,
  onInputChange,
  onKeyDown,
  onSend,
}: IChatInputAreaProps) {
  return (
    <div className="border-t p-4">
      <div className="flex space-x-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isAgentReady ? 'Type your message...' : 'Run your code first to enable chat'}
          className="flex-1 px-3 py-2 border rounded-md text-sm bg-background disabled:opacity-50"
          disabled={!isAgentReady || isLoading}
        />
        <Button
          onClick={() => {
            void onSend();
          }}
          disabled={!isAgentReady || isLoading || !input.trim()}
          size="sm"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      <ChatInputHint isAgentReady={isAgentReady} />
    </div>
  );
}

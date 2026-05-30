'use client';

import type { KeyboardEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '../../ui/button';
import { ChatInputHint } from './chat-input-hint';
import type { ISlashCommand } from './types';

interface IChatInputAreaProps {
  input: string;
  inputRef: RefObject<HTMLInputElement | null>;
  isAgentReady: boolean;
  isLoading: boolean;
  onInputChange: (input: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSend: () => Promise<void>;
  availableCommands?: ISlashCommand[];
}

export function ChatInputArea({
  input,
  inputRef,
  isAgentReady,
  isLoading,
  onInputChange,
  onKeyDown,
  onSend,
  availableCommands = [],
}: IChatInputAreaProps) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const showDropdown =
    isAgentReady && !isLoading && input.startsWith('/') && availableCommands.length > 0;

  const query = input.slice(1).toLowerCase();
  const filtered = showDropdown
    ? availableCommands.filter((c) => c.name.toLowerCase().startsWith(query))
    : [];

  const isDropdownVisible = showDropdown && filtered.length > 0;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [input]);

  const selectCommand = (cmd: ISlashCommand) => {
    const withArgs = cmd.argumentHint ? `/${cmd.name} ` : `/${cmd.name}`;
    onInputChange(withArgs);
    inputRef.current?.focus();
  };

  const handleKeyDownWithDropdown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownVisible) {
      onKeyDown(e);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      const cmd = filtered[highlightedIndex];
      if (cmd) {
        e.preventDefault();
        selectCommand(cmd);
      } else {
        onKeyDown(e);
      }
    } else if (e.key === 'Escape') {
      onInputChange('');
    } else {
      onKeyDown(e);
    }
  };

  return (
    <div className="border-t p-4 relative">
      {isDropdownVisible && (
        <div
          ref={dropdownRef}
          className="absolute left-4 right-4 bottom-full mb-1 bg-card border border-violet-500/30 rounded-md shadow-lg z-50 overflow-hidden"
        >
          {filtered.map((cmd, i) => (
            <button
              key={cmd.name}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm flex items-start gap-2 transition-colors ${
                i === highlightedIndex
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'text-foreground hover:bg-muted/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectCommand(cmd);
              }}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              <span className="font-mono text-violet-400 shrink-0">/{cmd.name}</span>
              <span className="text-muted-foreground text-xs mt-0.5 truncate">
                {cmd.description}
              </span>
              {cmd.argumentHint && (
                <span className="text-xs text-muted-foreground/60 shrink-0 mt-0.5 ml-auto">
                  {cmd.argumentHint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="flex space-x-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDownWithDropdown}
          placeholder={
            isAgentReady ? 'Type your message...' : 'Create an agent first to enable chat'
          }
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

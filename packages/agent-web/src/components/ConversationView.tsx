'use client';

import React from 'react';
import type { IConversationMessage, IActiveTool } from '../hooks/useWsSession.js';

interface IConversationViewProps {
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
}

export function ConversationView({
  messages,
  activeTools,
  streamingText,
  isThinking,
}: IConversationViewProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
        >
          <span className="text-xs text-muted-foreground">
            {msg.role === 'user' ? 'You' : 'Agent'}
          </span>
          <div
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-card border border-border text-card-foreground'
            }`}
          >
            {msg.content}
          </div>
        </div>
      ))}

      {isThinking && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="animate-pulse">●</span>
          <span>Thinking…</span>
        </div>
      )}

      {activeTools.map((tool) => (
        <div
          key={tool.id}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
        >
          <span
            className={`h-2 w-2 rounded-full ${tool.status === 'running' ? 'animate-pulse bg-amber-400' : 'bg-emerald-400'}`}
          />
          <span className="font-mono">{tool.name}</span>
          <span>{tool.status === 'running' ? 'running…' : 'done'}</span>
        </div>
      ))}

      {streamingText && (
        <div className="flex flex-col gap-1 items-start">
          <span className="text-xs text-muted-foreground">Agent</span>
          <div className="max-w-[80%] rounded-lg border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap break-words text-card-foreground">
            {streamingText}
            <span className="ml-0.5 animate-pulse">▋</span>
          </div>
        </div>
      )}
    </div>
  );
}

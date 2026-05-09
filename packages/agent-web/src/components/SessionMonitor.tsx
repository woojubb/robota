'use client';

import React, { useState } from 'react';
import { useWsSession } from '../hooks/useWsSession.js';
import { ConversationView } from './ConversationView.js';

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
  error: 'Error',
};

const STATUS_COLOR: Record<string, string> = {
  connected: 'bg-emerald-400',
  connecting: 'animate-pulse bg-amber-400',
  disconnected: 'bg-zinc-500',
  error: 'bg-rose-500',
};

interface ISessionMonitorProps {
  /** WebSocket URL of the agent-cli sidecar. Default: ws://localhost:4242 */
  defaultUrl?: string;
  className?: string;
}

export function SessionMonitor({
  defaultUrl = 'ws://localhost:4242',
  className,
}: ISessionMonitorProps): React.ReactElement {
  const [url, setUrl] = useState(defaultUrl);
  const [inputUrl, setInputUrl] = useState(defaultUrl);

  const { status, messages, activeTools, streamingText, isThinking, send } = useWsSession(url);

  return (
    <div className={`flex flex-col h-full overflow-hidden ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <span
          className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[status] ?? 'bg-zinc-500'}`}
        />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          CLI Monitor
        </span>
        <span className="text-xs text-muted-foreground">{STATUS_LABEL[status] ?? status}</span>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="h-7 rounded border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:border-primary w-52"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setUrl(inputUrl);
            }}
            placeholder="ws://localhost:4242"
          />
          <button
            className="h-7 rounded border border-border px-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            onClick={() => setUrl(inputUrl)}
          >
            Connect
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-hidden">
        {status === 'disconnected' || status === 'connecting' ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {status === 'connecting'
              ? `Connecting to ${url}…`
              : `Not connected. Run robota --web to start the sidecar.`}
          </div>
        ) : (
          <ConversationView
            messages={messages}
            activeTools={activeTools}
            streamingText={streamingText}
            isThinking={isThinking}
          />
        )}
      </div>

      {/* Phase 2: input area (submit to session) */}
      <SessionInput
        enabled={status === 'connected'}
        onSubmit={(prompt) => send({ type: 'submit', prompt })}
      />
    </div>
  );
}

function SessionInput({
  enabled,
  onSubmit,
}: {
  enabled: boolean;
  onSubmit: (prompt: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState('');

  const handleSubmit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <div className="border-t border-border px-3 py-2 flex gap-2 items-end">
      <textarea
        className="flex-1 resize-none rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary min-h-[36px] max-h-[120px]"
        rows={1}
        placeholder={enabled ? 'Send a message to the CLI session…' : 'Connect to send messages'}
        disabled={!enabled}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <button
        className="h-9 rounded border border-border px-3 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-40"
        disabled={!enabled || !value.trim()}
        onClick={handleSubmit}
      >
        Send
      </button>
    </div>
  );
}

'use client';

import React, { useState } from 'react';

import { useWsSession } from '../hooks/useSessionClient.js';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { ConversationView } from './ConversationView.js';

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; glow: string }> = {
  connected: {
    label: 'Connected',
    dot: 'bg-accent',
    text: 'text-muted-foreground',
    glow: 'status-glow',
  },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-warning animate-pulse',
    text: 'text-warning',
    glow: '',
  },
  disconnected: { label: 'Disconnected', dot: 'bg-subtle', text: 'text-subtle', glow: '' },
  error: { label: 'Error', dot: 'bg-destructive', text: 'text-destructive', glow: '' },
};

interface ISessionMonitorProps {
  /** WebSocket URL. Injected by the HTTP server via <meta name="ws-url">. */
  wsUrl: string;
  className?: string;
}

export function SessionMonitor({ wsUrl, className }: ISessionMonitorProps): React.ReactElement {
  const [url, setUrl] = useState(wsUrl);
  const [inputUrl, setInputUrl] = useState(wsUrl);

  const { status, messages, activeTools, streamingText, isThinking, executionWorkspace, send } =
    useWsSession(url);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected;

  const backgroundTasks =
    executionWorkspace?.entries.filter(
      (e) => e.kind === 'background_task' && e.visibility !== 'collapsed',
    ) ?? [];
  const hasAgents = backgroundTasks.length > 0;

  return (
    <div className={`robota-ui flex flex-col h-full overflow-hidden bg-background ${className ?? ''}`}>
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center gap-3 px-5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.glow}`} />
          <span className="text-[15px] font-semibold text-foreground">CLI monitor</span>
          <span role="status" className={`text-[13px] ${cfg.text}`}>
            {cfg.label}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            aria-label="WebSocket URL"
            className="h-8 w-60 rounded-lg bg-raised px-3 font-mono text-[12.5px] text-foreground placeholder:text-subtle focus:outline-none"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setUrl(inputUrl);
            }}
            placeholder="ws://localhost:7070"
          />
          <button
            className="h-8 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            onClick={() => setUrl(inputUrl)}
          >
            Connect
          </button>
        </div>
      </div>

      {/* Main content: conversation + optional agent panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: conversation */}
        <div
          className={`flex flex-col overflow-hidden min-w-0 ${hasAgents ? 'flex-[2]' : 'flex-1'}`}
        >
          <div className="flex-1 overflow-hidden">
            {status === 'connected' ? (
              <ConversationView
                messages={messages}
                activeTools={activeTools}
                streamingText={streamingText}
                isThinking={isThinking}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-center px-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card">
                    <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
                  </div>
                  <p className="max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
                    {status === 'connecting'
                      ? `Connecting to ${url}…`
                      : status === 'error'
                        ? `Connection error — could not reach ${url}. Check the CLI is running and the URL is correct.`
                        : `Run robota to start the CLI (WS transport starts automatically).`}
                  </p>
                </div>
              </div>
            )}
          </div>

          <SessionInput
            enabled={status === 'connected'}
            onSubmit={(prompt) => send({ type: 'submit', prompt })}
          />
        </div>

        {/* Right: agent activity panel (conditional) */}
        {hasAgents && <AgentActivityPanel tasks={backgroundTasks} className="flex-1 bg-sidebar" />}
      </div>
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
    <div className="mx-auto flex w-full max-w-[760px] flex-shrink-0 items-end gap-2 px-6 pb-4">
      <textarea
        aria-label="Message"
        className="max-h-[160px] min-h-[48px] flex-1 resize-none rounded-[22px] bg-card px-4 py-3 text-[15px] leading-relaxed text-foreground placeholder:text-subtle [field-sizing:content] focus:outline-none disabled:opacity-60"
        rows={1}
        placeholder={enabled ? 'Send a message…' : 'Connect to send messages'}
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
        className="h-12 rounded-[22px] bg-primary px-5 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:bg-raised disabled:text-subtle"
        disabled={!enabled || !value.trim()}
        onClick={handleSubmit}
      >
        Send
      </button>
    </div>
  );
}

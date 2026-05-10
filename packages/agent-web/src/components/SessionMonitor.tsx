'use client';

import React, { useState } from 'react';
import { useWsSession } from '../hooks/useWsSession.js';
import { ConversationView } from './ConversationView.js';

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; glow: string }> = {
  connected: {
    label: 'Connected',
    dot: 'bg-emerald-400',
    text: 'text-emerald-400',
    glow: 'shadow-[0_0_7px_1px_rgba(52,211,153,0.55)]',
  },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-amber-400 animate-pulse',
    text: 'text-amber-400',
    glow: '',
  },
  disconnected: {
    label: 'Disconnected',
    dot: 'bg-zinc-600',
    text: 'text-zinc-500',
    glow: '',
  },
  error: {
    label: 'Error',
    dot: 'bg-rose-500',
    text: 'text-rose-400',
    glow: '',
  },
};

interface ISessionMonitorProps {
  /** WebSocket URL. Injected by the HTTP server via <meta name="ws-url">. */
  wsUrl: string;
  className?: string;
}

export function SessionMonitor({ wsUrl, className }: ISessionMonitorProps): React.ReactElement {
  const [url, setUrl] = useState(wsUrl);
  const [inputUrl, setInputUrl] = useState(wsUrl);

  const { status, messages, activeTools, streamingText, isThinking, send } = useWsSession(url);
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected;

  return (
    <div className={`flex flex-col h-full overflow-hidden bg-background ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5 bg-card/30 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${cfg.dot} ${cfg.glow}`} />
          <span className="text-[11px] font-mono font-semibold tracking-[0.14em] uppercase text-foreground/70">
            CLI Monitor
          </span>
          <span className="text-border/60 font-mono text-xs">·</span>
          <span className={`text-[11px] font-mono ${cfg.text}`}>{cfg.label}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="h-7 rounded-lg border border-border/60 bg-background/60 px-2.5 text-[11px] font-mono text-foreground/70 placeholder:text-muted-foreground/35 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/15 w-52 transition-all"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setUrl(inputUrl);
            }}
            placeholder="ws://localhost:7070"
          />
          <button
            className="h-7 rounded-lg border border-border/60 px-3 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
            onClick={() => setUrl(inputUrl)}
          >
            Connect
          </button>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-hidden">
        {status === 'disconnected' || status === 'connecting' ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center px-8">
              <div className="h-9 w-9 rounded-full border border-border/50 flex items-center justify-center">
                <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
              </div>
              <p className="text-xs font-mono text-muted-foreground max-w-[260px] leading-relaxed">
                {status === 'connecting'
                  ? `Connecting to ${url}…`
                  : `Run robota --web to start the sidecar.`}
              </p>
            </div>
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

      {/* Input */}
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
    <div className="border-t border-border/50 px-3 py-2.5 flex gap-2 items-end bg-card/20 flex-shrink-0">
      <textarea
        className="flex-1 resize-none rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:border-primary/45 focus:ring-1 focus:ring-primary/15 min-h-[36px] max-h-[120px] transition-all font-[inherit] leading-relaxed"
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
        className="h-9 rounded-xl border border-border/60 px-3.5 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
        disabled={!enabled || !value.trim()}
        onClick={handleSubmit}
      >
        Send
      </button>
    </div>
  );
}

'use client';

import {
  ConversationView,
  PermissionPrompt,
  RobotaMark,
  RobotaWordmark,
} from '@robota-sdk/agent-ui-web';
import React, { useMemo } from 'react';

import { parseRemoteClientLocation } from '../client/parse-remote-location.js';
import { useRtcSession, type TSessionStatus } from '../hooks/useRtcSession.js';

/**
 * Stage-D browser remote client root (REMOTE-009). Reads its connection inputs from its own URL
 * (relay ← query, rendezvous + secret ← fragment), pairs with the host over WebRTC, and co-drives the
 * session — rendering the pairing-UX states and the owner's permission/ask prompts. Its root carries the
 * GUI surface's `robota-ui` scope, so it looks like the desktop app on any host that loads the surface
 * styles, without touching that host's own tokens.
 */

const STATUS_LABEL: Record<TSessionStatus, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting to relay…',
  pairing: 'Pairing with host…',
  'awaiting-approval': 'Waiting for the host to approve this connection…',
  connected: 'Connected',
  refused: 'The host did not approve this connection',
  failed: 'Pairing failed',
  error: 'Error',
};

interface IRemoteClientProps {
  /** The page href (defaults to `window.location.href`; injectable for tests). */
  href?: string;
}

export function RemoteClient({ href }: IRemoteClientProps): React.ReactElement {
  const parsed = useMemo(() => {
    try {
      return { location: parseRemoteClientLocation(href ?? window.location.href), error: null };
    } catch (e) {
      return { location: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [href]);

  if (parsed.error || !parsed.location) {
    return (
      <div className="robota-ui flex h-full min-h-screen items-center justify-center bg-background p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <RobotaMark size={40} />
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Cannot pair</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {parsed.error ?? 'Invalid pairing link.'}
          </p>
          <p className="text-[14px] text-subtle">
            Open the QR code or link shown by <code className="font-mono">/remote-control</code> on
            the host.
          </p>
        </div>
      </div>
    );
  }

  return <RemoteClientConnected location={parsed.location} />;
}

/** Where the pairing stands, as the title bar's dot. */
function statusTone(status: TSessionStatus): 'live' | 'waiting' | 'stopped' {
  if (status === 'connected') return 'live';
  if (status === 'failed' || status === 'refused' || status === 'error') return 'stopped';
  return 'waiting';
}

const DOT: Record<ReturnType<typeof statusTone>, string> = {
  live: 'bg-accent status-glow',
  waiting: 'bg-warning animate-pulse',
  stopped: 'bg-destructive',
};

function RemoteClientConnected({
  location,
}: {
  location: NonNullable<ReturnType<typeof parseRemoteClientLocation>>;
}): React.ReactElement {
  const session = useRtcSession(location);
  const tone = statusTone(session.status);
  const hasConversation =
    session.messages.length > 0 ||
    session.activeTools.length > 0 ||
    session.isThinking ||
    session.streamingText !== '';
  return (
    <div className="robota-ui flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex h-12 flex-shrink-0 items-center gap-3 px-5">
        <RobotaWordmark surface="remote" />
        <span className="ml-auto flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
          <span role="status">{STATUS_LABEL[session.status]}</span>
        </span>
      </header>
      <main className="min-h-0 flex-1">
        {hasConversation || tone === 'live' ? (
          <ConversationView
            messages={session.messages}
            activeTools={session.activeTools}
            streamingText={session.streamingText}
            isThinking={session.isThinking}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="gui-rise flex max-w-md flex-col items-center gap-4 text-center">
              <RobotaMark size={40} />
              <p className="text-[18px] font-medium">{STATUS_LABEL[session.status]}</p>
              {tone === 'stopped' ? (
                <p className="text-[15px] text-muted-foreground">
                  Open a fresh link from <code className="font-mono">/remote-control</code> on the
                  host to try again.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </main>
      <PermissionPrompt
        prompts={session.pendingPrompts}
        onAnswerPermission={session.answerPermission}
        onAnswerAsk={session.answerAsk}
      />
    </div>
  );
}

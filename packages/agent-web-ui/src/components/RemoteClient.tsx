'use client';

import React, { useMemo } from 'react';

import { ConversationView } from './ConversationView.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { parseRemoteClientLocation } from '../client/parse-remote-location.js';
import { useRtcSession } from '../hooks/useWsSession.js';

/**
 * Stage-D browser remote client root (REMOTE-009). Reads its connection inputs from its own URL
 * (relay ← query, rendezvous + secret ← fragment), pairs with the host over WebRTC, and co-drives the
 * session — rendering the pairing-UX states and the owner's permission/ask prompts.
 */

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting to relay…',
  pairing: 'Pairing with host…',
  connected: 'Connected',
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
      <div className="flex min-h-screen items-center justify-center p-8 font-mono text-[13px]">
        <div className="max-w-md text-[var(--muted-foreground)]">
          <p className="mb-2 font-bold text-[var(--foreground)]">Cannot pair</p>
          <p>{parsed.error ?? 'Invalid pairing link.'}</p>
          <p className="mt-2">Open the QR / link shown by `/remote-control` on the host.</p>
        </div>
      </div>
    );
  }

  return <RemoteClientConnected location={parsed.location} />;
}

function RemoteClientConnected({
  location,
}: {
  location: NonNullable<ReturnType<typeof parseRemoteClientLocation>>;
}): React.ReactElement {
  const session = useRtcSession(location);
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2 font-mono text-[12px]">
        <span
          className={
            session.status === 'connected'
              ? 'text-emerald-400'
              : session.status === 'failed' || session.status === 'error'
                ? 'text-rose-400'
                : 'text-amber-400'
          }
        >
          ● {STATUS_LABEL[session.status] ?? session.status}
        </span>
      </header>
      <main className="flex-1 overflow-auto">
        <ConversationView
          messages={session.messages}
          activeTools={session.activeTools}
          streamingText={session.streamingText}
          isThinking={session.isThinking}
        />
      </main>
      <PermissionPrompt
        prompts={session.pendingPrompts}
        onAnswerPermission={session.answerPermission}
        onAnswerAsk={session.answerAsk}
      />
    </div>
  );
}

import { SessionSurface, useWsSession } from '@robota-sdk/agent-ui-web/client';
import { useEffect, useRef } from 'react';

import { Button } from './ui.js';

import type { IConversationMessage, TConversationEntry } from '@robota-sdk/agent-ui-web/client';

function lastAnswer(messages: readonly TConversationEntry[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index] as Partial<IConversationMessage>;
    if (
      entry.role === 'assistant' &&
      typeof entry.content === 'string' &&
      entry.content.trim() !== ''
    )
      return entry.content;
  }
  return undefined;
}

/**
 * A side chat: its own connection, so its own chat, opened beside the main one. Nothing said here
 * reaches the main chat unless the person brings it back, and then as their own message.
 */
export function SideChat({
  wsUrl,
  onBringBack,
  onClose,
}: {
  readonly wsUrl: string;
  readonly onBringBack: (text: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const side = useWsSession(wsUrl);
  const started = useRef(false);
  const compact = useRef(false);
  // The panel is narrow: the side chat's own chat list stays closed (it is this connection's alone).
  useEffect(() => {
    if (compact.current || side.status !== 'connected') return;
    compact.current = true;
    side.setSessionSidebarOpen(false);
  }, [side.status, side.setSessionSidebarOpen]);
  useEffect(() => {
    if (started.current || side.status !== 'connected' || side.newSession === undefined) return;
    started.current = true;
    side.newSession();
  }, [side.status, side.newSession]);
  const answer = lastAnswer(side.messages);
  return (
    <aside
      aria-label="Side chat"
      className="flex h-full w-[480px] flex-shrink-0 flex-col border-l border-border"
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[14px] font-semibold">Side chat</span>
        <span className="ml-auto flex gap-2">
          <Button
            disabled={answer === undefined}
            onClick={() => answer !== undefined && onBringBack(answer)}
          >
            Bring back
          </Button>
          <Button onClick={onClose}>Close</Button>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <SessionSurface state={side} surface="web" draftMode="volatile" />
      </div>
    </aside>
  );
}

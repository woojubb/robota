import { SessionSurface, useWsSession } from '@robota-sdk/agent-ui-web/client';
import { useEffect, useRef, useState } from 'react';

import { Button, inputClass } from './ui.js';

import type { IConversationMessage, TConversationEntry } from '@robota-sdk/agent-ui-web/client';

/** How many of the main chat's latest turns a side chat can start from, and how much of each. */
const CONTEXT_TURNS = 6;
const CONTEXT_TURN_LENGTH = 600;

function textOf(entry: TConversationEntry): { role: string; text: string } | undefined {
  const message = entry as Partial<IConversationMessage>;
  if (
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim() !== ''
  )
    return { role: message.role, text: message.content.trim() };
  return undefined;
}

function lastAnswer(messages: readonly TConversationEntry[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turn = textOf(messages[index]!);
    if (turn?.role === 'assistant') return turn.text;
  }
  return undefined;
}

/**
 * The main chat's latest turns, quoted for a side chat to start from; undefined when the main chat
 * has nothing yet. It is quoted text in the person's first message, not a shared conversation.
 */
export function recentTurns(messages: readonly TConversationEntry[]): string | undefined {
  const turns = messages
    .map(textOf)
    .filter((turn): turn is { role: string; text: string } => turn !== undefined)
    .slice(-CONTEXT_TURNS);
  if (turns.length === 0) return undefined;
  const quoted = turns.map((turn) => {
    const text =
      turn.text.length <= CONTEXT_TURN_LENGTH
        ? turn.text
        : `${turn.text.slice(0, CONTEXT_TURN_LENGTH - 1)}…`;
    return `${turn.role === 'user' ? 'Me' : 'You'}: ${text}`;
  });
  return `For context, the latest turns of my main chat:\n\n${quoted.join('\n\n')}`;
}

/**
 * A side chat: its own connection, so its own chat, opened beside the main one. Nothing said here
 * reaches the main chat unless the person brings it back, and then as their own message. A new side
 * chat can start from the main chat's latest turns; a listed one reopens where it was.
 */
export function SideChat({
  wsUrl,
  resumeId,
  context,
  onStarted,
  onBringBack,
  onClose,
}: {
  readonly wsUrl: string;
  /** The side chat to reopen; a new one starts when absent. */
  readonly resumeId?: string;
  /** The main chat's latest turns, offered to a new side chat. */
  readonly context?: string;
  /**
   * A new side chat got its first message: record it so the menu lists it. Resolves to the title the
   * record kept (a question that looks like a secret is not kept), or undefined when it was not kept.
   */
  readonly onStarted: (sessionId: string, title: string) => Promise<string | undefined>;
  readonly onBringBack: (text: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const side = useWsSession(wsUrl);
  const started = useRef(false);
  const compact = useRef(false);
  const [question, setQuestion] = useState('');
  const [withContext, setWithContext] = useState(context !== undefined);
  // Set once the first message is sent; the session id is read from a listing that arrives after it.
  const pending = useRef<{ title: string; listing: unknown } | undefined>(undefined);
  const [asked, setAsked] = useState(false);
  // The panel is narrow: the side chat's own chat list stays closed (it is this connection's alone).
  useEffect(() => {
    if (compact.current || side.status !== 'connected') return;
    compact.current = true;
    side.setSessionSidebarOpen(false);
  }, [side.status, side.setSessionSidebarOpen]);
  useEffect(() => {
    if (started.current || side.status !== 'connected') return;
    if (resumeId !== undefined) {
      started.current = true;
      side.switchSession(resumeId);
    } else if (side.newSession !== undefined) {
      started.current = true;
      side.newSession();
    }
  }, [side.status, side.newSession, side.switchSession, resumeId]);
  useEffect(() => {
    const waiting = pending.current;
    const listing = side.sessionListing;
    if (waiting === undefined || listing === null || listing === waiting.listing) return;
    pending.current = undefined;
    void onStarted(listing.currentSessionId, waiting.title).then((kept) => {
      if (kept !== undefined) setNaming(kept);
    });
  }, [side.sessionListing, onStarted]);
  const answer = lastAnswer(side.messages);
  // Named after the question as the record kept it, rather than the quoted context its first
  // message starts with, once the first turn is over (a session busy with a turn is not renamed).
  const [naming, setNaming] = useState<string | undefined>(undefined);
  const turnOver = answer !== undefined && !side.isThinking && side.activeTools.length === 0;
  useEffect(() => {
    if (naming === undefined || !turnOver) return;
    setNaming(undefined);
    // The open session's own rename path; renaming it through the list would be overwritten.
    side.sendCommandSilently('rename', `Side: ${naming.slice(0, 60)}`);
  }, [naming, turnOver, side.sendCommandSilently]);
  const starting = resumeId === undefined && !asked && side.messages.length === 0;
  return (
    <aside
      aria-label="Side chat"
      className="absolute inset-0 z-20 flex h-full flex-col bg-background md:static md:w-[480px] md:flex-shrink-0 md:border-l md:border-border"
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
      {starting ? (
        <form
          aria-label="Start a side chat"
          className="flex flex-col gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const asking = question.trim();
            if (asking === '' || side.status !== 'connected') return;
            const prompt =
              withContext && context !== undefined
                ? `${context}\n\nMy question: ${asking}`
                : asking;
            pending.current = { title: asking, listing: side.sessionListing };
            setAsked(true);
            side.send({ type: 'submit', prompt });
            side.requestSessions();
          }}
        >
          <label className="flex flex-col gap-1 text-[13px]">
            Ask on the side
            <textarea
              className={inputClass}
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          {context !== undefined && (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="checkbox"
                checked={withContext}
                onChange={(event) => setWithContext(event.target.checked)}
              />
              Start from the main chat's latest turns
            </label>
          )}
          <div>
            <Button type="submit" tone="primary" disabled={side.status !== 'connected'}>
              Ask
            </Button>
          </div>
        </form>
      ) : (
        <div className="min-h-0 flex-1">
          <SessionSurface state={side} surface="web" draftMode="volatile" />
        </div>
      )}
    </aside>
  );
}

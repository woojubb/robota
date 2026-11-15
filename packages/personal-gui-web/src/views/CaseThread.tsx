import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, when } from './ui.js';

import type { ICaseView, IPersonalApi, TCaseEventKind } from '../api.js';

const REFRESH_MS = 3_000;

const EVENT_LABEL: Record<TCaseEventKind, string> = {
  observed: 'Noticed',
  noted: 'Noted',
  asked: 'Asked you',
  answered: 'You answered',
  closed: 'Closed',
};

/**
 * One case as a thread, oldest first: what the agent noticed and noted, the question it asked, the
 * person's answer and how it closed. A question still waiting is answered from the feed. Every text is
 * shown as written: what the agent noticed and noted came from what other people wrote, and a link in
 * it must not become clickable.
 */
export function CaseThread({
  api,
  caseId,
  onBack,
}: {
  readonly api: IPersonalApi;
  readonly caseId: string;
  readonly onBack: () => void;
}): React.ReactElement {
  const [thread, setThread] = useState<ICaseView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setThread(await api.caseThread(caseId));
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, caseId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <ViewFrame title="Case" actions={<Button onClick={onBack}>Back to feed</Button>}>
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {thread === undefined && error === undefined && <Notice>Loading…</Notice>}
      {thread !== undefined && (
        <article className="flex max-w-3xl flex-col gap-4 p-4">
          <header>
            <h2 className="text-[18px] font-semibold">{thread.title}</h2>
            <p className="text-[13px] text-muted-foreground">
              {thread.state === 'open' ? 'Open' : 'Closed'} · opened {when(thread.createdAt)}
            </p>
          </header>
          <ol aria-label="History" className="flex flex-col gap-2">
            {thread.history.map((event, index) => (
              <li key={index} className="rounded-lg border border-border p-3 text-[13px]">
                <div className="text-muted-foreground">
                  {EVENT_LABEL[event.kind]} · {when(event.at)}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px]">{event.text}</p>
              </li>
            ))}
          </ol>
          {thread.question !== undefined && (
            <section aria-label="Waiting for you" className="rounded-lg border border-warning p-3">
              <p className="text-[13px] text-muted-foreground">Waiting for your answer</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] font-medium">
                {thread.question.text}
              </p>
              {thread.question.options.length > 0 && (
                <p className="mt-1 text-[13px]">{thread.question.options.join(' · ')}</p>
              )}
              <p className="mt-1 text-[12.5px] text-muted-foreground">Answer it from your feed.</p>
            </section>
          )}
        </article>
      )}
    </ViewFrame>
  );
}

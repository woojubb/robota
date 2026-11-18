import { MarkdownText } from '@robota-sdk/agent-ui-web/client';
import { useCallback, useEffect, useState } from 'react';

import { CaseThread } from './CaseThread.js';
import { CaseList } from './CaseList.js';
import { QuestionCard } from './QuestionCard.js';
import { Button, Notice, ViewFrame, errorText, when } from './ui.js';

import type { IFeedItemView, IPersonalApi, TQuestionAnswer } from '../api.js';

const REFRESH_MS = 3_000;

const STATE_LABEL = {
  approved: 'You approved this',
  denied: 'You declined this',
  expired: 'No longer waiting',
  pending: '',
} as const;

/**
 * What the agent did or needs while the person was away. An approval here answers the very request
 * a goal is waiting on: the goal resumes when the person approves, and nothing is sent when they
 * decline. A question is answered on its card, and its case opens as a thread.
 */
export function FeedView({
  api,
  onOpenGoal,
  onItems,
}: {
  readonly api: IPersonalApi;
  readonly onOpenGoal: (goalId: string) => void;
  /** Told whenever the feed is read, so the page can show how many questions wait without asking again. */
  readonly onItems?: (items: readonly IFeedItemView[]) => void;
}): React.ReactElement {
  const [items, setItems] = useState<readonly IFeedItemView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [thread, setThread] = useState<string | undefined>(undefined);
  const [showCases, setShowCases] = useState(false);
  const reload = useCallback(async () => {
    try {
      const read = await api.feed();
      setItems(read);
      setError(undefined);
      onItems?.(read);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, onItems]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const act = async (id: string, action: 'approve' | 'deny' | 'dismiss'): Promise<void> => {
    try {
      await api.answerFeed(id, action);
    } catch (caught) {
      setError(errorText(caught));
    }
    await reload();
  };
  // A refused answer is shown on its card, and the feed is read again whatever happened.
  const answer = async (id: string, given: TQuestionAnswer): Promise<void> => {
    try {
      await api.answerQuestion(id, given);
    } finally {
      await reload();
    }
  };
  if (thread !== undefined)
    return (
      <CaseThread
        api={api}
        caseId={thread}
        onBack={() => setThread(undefined)}
        backLabel={showCases ? 'Back to cases' : 'Back to feed'}
      />
    );
  if (showCases)
    return <CaseList api={api} onBack={() => setShowCases(false)} onOpenCase={setThread} />;
  return (
    <ViewFrame
      title="Feed"
      actions={<Button onClick={() => setShowCases(true)}>View cases</Button>}
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {items !== undefined && items.length === 0 && (
        <Notice>
          Nothing new. Results from your goals and anything that needs you will show here.
        </Notice>
      )}
      <ul className="flex max-w-3xl flex-col gap-2 p-4">
        {(items ?? []).map((item) => {
          if (item.question !== undefined) {
            return (
              <QuestionCard
                key={item.id}
                item={item}
                question={item.question}
                onAnswer={(given) => answer(item.id, given)}
                onOpenThread={() => setThread(item.question!.caseId)}
                onDismiss={() => void act(item.id, 'dismiss')}
              />
            );
          }
          const pending = item.approval?.state === 'pending';
          return (
            <li
              key={item.id}
              className={`rounded-lg border p-3 ${pending ? 'border-warning' : 'border-border'}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] font-medium uppercase tracking-wide text-subtle">
                  {item.kind === 'approval'
                    ? 'Needs you'
                    : item.kind === 'report'
                      ? 'Report'
                      : 'Notice'}
                </span>
                <h2 className="text-[14px] font-semibold">{item.title}</h2>
                <span className="ml-auto text-[12px] text-muted-foreground">{when(item.at)}</span>
              </div>
              {item.kind === 'approval' ? (
                <p className="mt-1 whitespace-pre-wrap text-[14px]">{item.body}</p>
              ) : (
                <MarkdownText className="mt-1 text-[14px]">{item.body}</MarkdownText>
              )}
              {item.approval !== undefined && (
                <p className="mt-2 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[12.5px]">
                  {item.approval.detail}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {pending ? (
                  <>
                    <Button tone="primary" onClick={() => void act(item.id, 'approve')}>
                      Approve
                    </Button>
                    <Button tone="danger" onClick={() => void act(item.id, 'deny')}>
                      Decline
                    </Button>
                  </>
                ) : (
                  <>
                    {item.approval !== undefined && (
                      <span className="text-[12.5px] text-muted-foreground">
                        {STATE_LABEL[item.approval.state]}
                      </span>
                    )}
                    <span className="ml-auto flex gap-2">
                      {item.goalId !== undefined && (
                        <Button onClick={() => onOpenGoal(item.goalId!)}>Open goal</Button>
                      )}
                      <Button onClick={() => void act(item.id, 'dismiss')}>Dismiss</Button>
                    </span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </ViewFrame>
  );
}

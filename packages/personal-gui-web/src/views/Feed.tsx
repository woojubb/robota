import { MarkdownText } from '@robota-sdk/agent-ui-web/client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CaseThread } from './CaseThread.js';
import { CaseList } from './CaseList.js';
import { ProgressChip } from './LaunchStatus.js';
import { OfferFeedEntries } from './OfferFeed.js';
import { QuestionCard } from './QuestionCard.js';
import { Button, Notice, ViewFrame, errorText, when } from './ui.js';

import type { IFeedItemView, IPersonalApi, TQuestionAnswer, TTaskProgress } from '../api.js';

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
 * decline. A question is answered on its card, and its case opens as a thread. Tasks the agent suggests
 * are listed after the rest as plain entries that open their card in Browse; they decide nothing.
 */
export function FeedView({
  api,
  onOpenGoal,
  onOpenTask,
  onOpenOffer,
  focusLaunch,
  onItems,
}: {
  readonly api: IPersonalApi;
  readonly onOpenGoal: (goalId: string) => void;
  /** Opens Browse to the card of a task the person started. */
  readonly onOpenTask?: (launchId: string) => void;
  /** Opens Browse to the card of a task the agent suggests; without it the Feed shows no suggestions. */
  readonly onOpenOffer?: (offerId: string) => void;
  /** The launch whose report the person is sent to from its card in Browse. */
  readonly focusLaunch?: string;
  /** Told whenever the feed is read, so the page can show how many questions wait without asking again. */
  readonly onItems?: (items: readonly IFeedItemView[]) => void;
}): React.ReactElement {
  const [items, setItems] = useState<readonly IFeedItemView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [thread, setThread] = useState<string | undefined>(undefined);
  const [showCases, setShowCases] = useState(false);
  // Where each started task stands, for the items of goals a task made; empty until the agent says.
  const [standing, setStanding] = useState<ReadonlyMap<string, TTaskProgress>>(new Map());
  const focused = useRef<HTMLLIElement>(null);
  const reload = useCallback(async () => {
    try {
      const read = await api.feed();
      setItems(read);
      setError(undefined);
      onItems?.(read);
      if (read.some((item) => item.launchId !== undefined)) {
        try {
          const launches = await api.taskLaunches();
          setStanding(new Map(launches.map((launch) => [launch.id, launch.progress])));
        } catch {
          // allow-fallback: without where a task stands, its item points at the task instead of saying.
          setStanding(new Map());
        }
      }
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, onItems]);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);
  const focusedItem =
    focusLaunch === undefined
      ? undefined
      : items?.find((item) => item.launchId === focusLaunch && item.kind === 'report')?.id;
  useEffect(() => {
    if (focusedItem !== undefined) focused.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedItem]);
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
          const sent = item.id === focusedItem;
          // What a task's goal says as it ends is the model's own account, so it is shown as plain text.
          const launched = item.launchId !== undefined;
          const progress = item.launchId === undefined ? undefined : standing.get(item.launchId);
          return (
            <li
              key={item.id}
              ref={sent ? focused : undefined}
              aria-current={sent ? 'true' : undefined}
              className={`rounded-lg border p-3 ${
                pending ? 'border-warning' : sent ? 'border-primary' : 'border-border'
              }`}
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
              {item.kind === 'approval' || launched ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-[14px]">{item.body}</p>
              ) : (
                <MarkdownText className="mt-1 text-[14px]">{item.body}</MarkdownText>
              )}
              {item.approval !== undefined && (
                <p className="mt-2 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[12.5px]">
                  {item.approval.detail}
                </p>
              )}
              {launched && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                  {progress !== undefined && <ProgressChip progress={progress} />}
                  <span>From a task you started in Browse.</span>
                  {progress === undefined && (
                    <span>Open the task to see whether this was checked.</span>
                  )}
                  {onOpenTask !== undefined && (
                    <Button onClick={() => onOpenTask(item.launchId!)}>Open task</Button>
                  )}
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
      {onOpenOffer !== undefined && <OfferFeedEntries api={api} onOpenOffer={onOpenOffer} />}
    </ViewFrame>
  );
}

import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, when } from './ui.js';

import type { IFeedItemView, IPersonalApi } from '../api.js';

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
 * decline.
 */
export function FeedView({
  api,
  onOpenGoal,
}: {
  readonly api: IPersonalApi;
  readonly onOpenGoal: (goalId: string) => void;
}): React.ReactElement {
  const [items, setItems] = useState<readonly IFeedItemView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      setItems(await api.feed());
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api]);
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
  return (
    <ViewFrame title="Feed">
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {items !== undefined && items.length === 0 && (
        <Notice>
          Nothing new. Results from your goals and anything that needs you will show here.
        </Notice>
      )}
      <ul className="flex max-w-3xl flex-col gap-2 p-4">
        {(items ?? []).map((item) => {
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
              <p className="mt-1 whitespace-pre-wrap text-[14px]">{item.body}</p>
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

import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass, interval, when } from './ui.js';

import type { IGoalRunView, IGoalView, IPersonalApi } from '../api.js';

const REFRESH_MS = 3_000;

const STATUS_LABEL: Record<IGoalView['status'], string> = {
  active: 'Scheduled',
  running: 'Working',
  waiting: 'Waiting for you',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
};

function schedule(goal: IGoalView): string {
  return goal.everyMinutes === undefined ? 'Once' : interval(goal.everyMinutes);
}

/** Goals the agent keeps working on in the background: set up, steer, and see every run's report and actions. */
export function GoalsView({
  api,
  openGoal,
  onOpenGoal,
}: {
  readonly api: IPersonalApi;
  readonly openGoal: string | undefined;
  readonly onOpenGoal: (goalId: string | undefined) => void;
}): React.ReactElement {
  const [goals, setGoals] = useState<readonly IGoalView[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const reload = useCallback(async () => {
    try {
      setGoals(await api.goals());
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
  return (
    <ViewFrame
      title="Goals"
      actions={
        <Button
          tone="primary"
          onClick={() => {
            onOpenGoal(undefined);
            setCreating(true);
          }}
        >
          New goal
        </Button>
      }
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      <div className="flex h-full min-h-0">
        <ul className="w-72 flex-shrink-0 overflow-y-auto border-r border-border p-2">
          {goals !== undefined && goals.length === 0 && (
            <Notice>No goals yet. Ask your agent to keep an eye on something, or add one.</Notice>
          )}
          {(goals ?? []).map((goal) => (
            <li key={goal.id}>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  onOpenGoal(goal.id);
                }}
                className={`block w-full rounded-md px-2 py-1.5 text-left hover:bg-hover ${openGoal === goal.id ? 'bg-hover' : ''}`}
              >
                <div className="truncate text-[14px]">{goal.title}</div>
                <div className="text-[12px] text-muted-foreground">
                  {STATUS_LABEL[goal.status]} · {schedule(goal)}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {creating ? (
            <NewGoal
              api={api}
              onCancel={() => setCreating(false)}
              onCreated={async (goalId) => {
                setCreating(false);
                await reload();
                onOpenGoal(goalId);
              }}
            />
          ) : openGoal === undefined ? (
            <Notice>Choose a goal to see what your agent did and what it is waiting on.</Notice>
          ) : (
            <GoalDetail
              key={openGoal}
              api={api}
              goalId={openGoal}
              onChanged={reload}
              onGone={() => onOpenGoal(undefined)}
            />
          )}
        </div>
      </div>
    </ViewFrame>
  );
}

function NewGoal({
  api,
  onCreated,
  onCancel,
}: {
  readonly api: IPersonalApi;
  readonly onCreated: (goalId: string) => Promise<void>;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [every, setEvery] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      aria-label="New goal"
      className="flex max-w-xl flex-col gap-3 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const minutes = every.trim() === '' ? undefined : Number(every);
          const created = await api.createGoal({
            title,
            instructions,
            readOnly,
            ...(minutes !== undefined && { everyMinutes: minutes }),
          });
          await onCreated(created.goal.id);
        } catch (caught) {
          setError(errorText(caught));
        }
      }}
    >
      <h2 className="text-[15px] font-semibold">New goal</h2>
      <label className="flex flex-col gap-1 text-[13px]">
        Title
        <input
          className={inputClass}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        What should your agent do?
        <textarea
          className={inputClass}
          rows={4}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        Repeat every (minutes, empty for once)
        <input
          className={inputClass}
          inputMode="numeric"
          value={every}
          onChange={(event) => setEvery(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)}
        />
        Only look, never change anything
      </label>
      {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" tone="primary">
          Create goal
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function GoalDetail({
  api,
  goalId,
  onChanged,
  onGone,
}: {
  readonly api: IPersonalApi;
  readonly goalId: string;
  readonly onChanged: () => Promise<void>;
  readonly onGone: () => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<
    { goal: IGoalView; runs: readonly IGoalRunView[] } | undefined
  >(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setDetail(await api.goal(goalId));
      setError(undefined);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [api, goalId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);
  const act = async (action: 'pause' | 'resume' | 'run' | 'stop'): Promise<void> => {
    try {
      await api.goalAction(goalId, action);
      if (action === 'stop') {
        onGone();
      } else {
        await load();
      }
      await onChanged();
    } catch (caught) {
      setError(errorText(caught));
    }
  };
  if (detail === undefined)
    return error === undefined ? <Notice>Loading…</Notice> : <Notice tone="error">{error}</Notice>;
  const { goal, runs } = detail;
  const busy = goal.status === 'running' || goal.status === 'waiting';
  return (
    <article className="flex max-w-3xl flex-col gap-4 p-4">
      <header>
        <h2 className="text-[18px] font-semibold">{goal.title}</h2>
        <p className="text-[13px] text-muted-foreground">
          {STATUS_LABEL[goal.status]} · {schedule(goal)}
          {goal.readOnly ? ' · only looks' : ''} · next run {when(goal.nextRunAt)}
        </p>
      </header>
      {error !== undefined && <p className="text-[13px] text-destructive">{error}</p>}
      <p className="whitespace-pre-wrap rounded-lg border border-border p-3 text-[14px]">
        {goal.instructions}
      </p>
      <div className="flex gap-2">
        <Button tone="primary" disabled={busy} onClick={() => void act('run')}>
          Run now
        </Button>
        {goal.status === 'paused' ? (
          <Button onClick={() => void act('resume')}>Resume</Button>
        ) : (
          <Button disabled={busy} onClick={() => void act('pause')}>
            Pause
          </Button>
        )}
        <Button
          tone="danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Stop "${goal.title}" for good?`)) void act('stop');
          }}
        >
          Stop
        </Button>
      </div>
      <section aria-label="Runs" className="flex flex-col gap-2">
        <h3 className="text-[14px] font-semibold">Runs</h3>
        {runs.length === 0 && <p className="text-[13px] text-muted-foreground">Not run yet.</p>}
        {runs.map((run) => (
          <div key={run.id} className="rounded-lg border border-border p-3 text-[13px]">
            <div className="text-muted-foreground">
              {when(run.startedAt)} · {run.outcome ?? 'in progress'}
            </div>
            {run.report !== undefined && (
              <p className="mt-1 whitespace-pre-wrap text-[14px]">{run.report}</p>
            )}
            {run.actions.length > 0 && (
              <details className="mt-2">
                <summary>What your agent did ({run.actions.length})</summary>
                <ol className="mt-1 flex flex-col gap-0.5">
                  {run.actions.map((action, index) => (
                    <li key={index} className="break-all font-mono text-[12px]">
                      {action.tool} · {action.outcome} · {action.detail}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
      </section>
    </article>
  );
}

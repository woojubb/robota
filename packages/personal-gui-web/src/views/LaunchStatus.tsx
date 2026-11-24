import { useEffect, useState } from 'react';

import { Button, errorText, when } from './ui.js';

import type { IPersonalApi, ITaskLaunchStatusView, TTaskProgress } from '../api.js';

/** How often a launch that is still going is read again; the page stops at the first state that is an end. */
export const LAUNCH_REFRESH_MS = 3_000;

const LIVE: ReadonlySet<TTaskProgress> = new Set(['starting', 'running', 'waiting']);

const LABEL: Readonly<Record<TTaskProgress, string>> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting for you',
  verified: 'Completed (verified)',
  unverified: 'Unverified',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** A checked result looks different from an unchecked one, and neither is the colour of a state still going. */
const TONE: Readonly<Record<TTaskProgress, string>> = {
  starting: 'border-border text-muted-foreground',
  running: 'border-border text-muted-foreground',
  waiting: 'border-border text-foreground',
  verified: 'border-success bg-success/10 text-success',
  unverified: 'border-warning text-warning',
  failed: 'border-destructive text-destructive',
  cancelled: 'border-border text-muted-foreground',
};

const chip = 'rounded-full border px-2 py-0.5 text-[12px] font-medium';

/**
 * Where a started task stands, in the agent's own words: a chip, why, the run's report and what the
 * agent's browser recorded. Everything the agent sends is shown as the plain text it is: the report is
 * the model's own account and the evidence can quote a page, so nothing here becomes a link or markup.
 * Only a result the agent checked says completed; a run that ended without proof says unverified and
 * calls its report unchecked. While the task is still going the page reads it again every few seconds,
 * and stops once it has ended.
 */
export function LaunchStatus({
  api,
  launchId,
  initial,
  highlighted = false,
  onOpenGoal,
  onOpenFeed,
}: {
  readonly api: IPersonalApi;
  readonly launchId: string;
  /** What the page already knows of this launch, shown until the agent has been asked. */
  readonly initial?: ITaskLaunchStatusView;
  /** The launch the person was sent to from the Feed. */
  readonly highlighted?: boolean;
  readonly onOpenGoal?: (goalId: string) => void;
  /** Opens the Feed to this launch's report. */
  readonly onOpenFeed?: (launchId: string) => void;
}): React.ReactElement {
  const [launch, setLaunch] = useState<ITaskLaunchStatusView | undefined>(initial);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      let again = true;
      try {
        const next = await api.taskLaunch(launchId);
        if (!current) return;
        setLaunch(next);
        setProblem(undefined);
        again = LIVE.has(next.progress);
      } catch (caught) {
        if (!current) return;
        setProblem(errorText(caught));
      }
      if (again) timer = setTimeout(() => void read(), LAUNCH_REFRESH_MS);
    };
    // A launch the page already knows to be over is not asked about again.
    if (initial === undefined || LIVE.has(initial.progress)) void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `initial` is only where the page starts from; a launch is the one its id names.
  }, [api, launchId]);

  if (launch === undefined)
    return problem === undefined ? (
      <p role="status" className="mt-3 text-[13px] text-muted-foreground">
        Reading how it is going…
      </p>
    ) : (
      <p role="alert" className="mt-3 text-[13px] text-destructive">
        {problem}
      </p>
    );

  const verified = launch.progress === 'verified';
  const ended = !LIVE.has(launch.progress);
  return (
    <section
      aria-label="Task status"
      aria-live="polite"
      aria-current={highlighted ? 'true' : undefined}
      className={`mt-3 flex flex-col gap-2 rounded-md border p-3 ${
        highlighted ? 'border-primary' : 'border-border'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${chip} ${TONE[launch.progress]}`}>{LABEL[launch.progress]}</span>
        <span className="text-[12.5px] text-muted-foreground">
          {launch.decidedAt !== undefined
            ? `Decided ${when(launch.decidedAt)}`
            : `Started ${when(launch.createdAt)}`}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13.5px]">{launch.reason}</p>
      {launch.report !== undefined && (
        <div>
          <h5 className="text-[13px] font-medium">
            {verified ? 'Report' : 'Report (not checked)'}
          </h5>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px]">{launch.report}</p>
        </div>
      )}
      {ended && launch.evidence.length > 0 && (
        <div>
          <h5 className="text-[13px] font-medium">Evidence</h5>
          <ul aria-label="Evidence" className="mt-0.5 flex list-disc flex-col gap-1 pl-5">
            {launch.evidence.map((read) => (
              <li key={`${read.tool}-${read.at}-${read.digest}`} className="text-[13px]">
                <span>{read.tool === 'open' ? 'Opened ' : 'Read again '}</span>
                <span className="break-all">{read.address}</span>
                {read.requested !== undefined && read.requested !== read.address && (
                  <span className="text-muted-foreground">
                    {' '}
                    (asked for <span className="break-all">{read.requested}</span>)
                  </span>
                )}
                <span className="text-muted-foreground">
                  {' '}
                  · {when(read.at)} · {read.chars} characters
                </span>
                {read.excerpt !== undefined && (
                  <span className="block break-words text-muted-foreground">{read.excerpt}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ended && launch.evidence.length === 0 && launch.goalId !== undefined && !verified && (
        <p className="text-[12.5px] text-muted-foreground">
          Nothing your agent read was recorded for this run.
        </p>
      )}
      {problem !== undefined && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {launch.goalId !== undefined && onOpenGoal !== undefined && (
          <Button onClick={() => onOpenGoal(launch.goalId!)}>Open goal</Button>
        )}
        {ended &&
          launch.goalId !== undefined &&
          launch.progress !== 'cancelled' &&
          onOpenFeed !== undefined && (
            <Button onClick={() => onOpenFeed(launch.id)}>Open in Feed</Button>
          )}
      </div>
    </section>
  );
}

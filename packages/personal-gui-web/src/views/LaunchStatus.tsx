import { useEffect, useState } from 'react';

import { SetupSteps, accountLabel } from './TaskReadiness.js';
import { Button, errorText, when } from './ui.js';

import type { IPersonalApi, ITaskLaunchStatusView, TTaskProgress } from '../api.js';

/** How often a launch that is still going is read again; the page stops at the first state that is an end. */
export const LAUNCH_REFRESH_MS = 3_000;
/** How often a request that waits for the person is read again: it moves when setup is done, not when a run advances. */
export const LAUNCH_WAITING_REFRESH_MS = 10_000;

const WAITING_FOR_PERSON: ReadonlySet<TTaskProgress> = new Set(['setup', 'review']);
const LIVE: ReadonlySet<TTaskProgress> = new Set([
  'setup',
  'review',
  'starting',
  'running',
  'waiting',
]);

const LABEL: Readonly<Record<TTaskProgress, string>> = {
  setup: 'Needs setup',
  review: 'Needs your look',
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
  setup: 'border-border text-foreground',
  review: 'border-border text-foreground',
  starting: 'border-border text-muted-foreground',
  running: 'border-border text-muted-foreground',
  waiting: 'border-border text-foreground',
  verified: 'border-success bg-success/10 text-success',
  unverified: 'border-warning text-warning',
  failed: 'border-destructive text-destructive',
  cancelled: 'border-border text-muted-foreground',
};

const chip = 'rounded-full border px-2 py-0.5 text-[12px] font-medium';

/** The word for where a launch stands, styled so a checked result is apart from an unchecked one. */
export function ProgressChip({
  progress,
}: {
  readonly progress: TTaskProgress;
}): React.ReactElement {
  return <span className={`${chip} ${TONE[progress]}`}>{LABEL[progress]}</span>;
}

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
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  /**
   * One of the person's own moves on a request that waits: the agent answers with the request as it
   * stands, which replaces what is shown. A refusal is shown as the agent's words, and the request is
   * read again, since a refusal means what the page showed is no longer how it stands.
   */
  const move = async (act: () => Promise<ITaskLaunchStatusView>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      setLaunch(await act());
      setProblem(undefined);
    } catch (caught) {
      setProblem(errorText(caught));
      try {
        setLaunch(await api.taskLaunch(launchId));
      } catch {
        // allow-fallback: the next read of the request shows how it stands; the refusal is already shown.
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitingForPerson = initial !== undefined && WAITING_FOR_PERSON.has(initial.progress);
    const read = async (): Promise<void> => {
      let again = true;
      try {
        const next = await api.taskLaunch(launchId);
        if (!current) return;
        setLaunch(next);
        setProblem(undefined);
        again = LIVE.has(next.progress);
        waitingForPerson = WAITING_FOR_PERSON.has(next.progress);
      } catch (caught) {
        if (!current) return;
        setProblem(errorText(caught));
      }
      if (again)
        timer = setTimeout(
          () => void read(),
          waitingForPerson ? LAUNCH_WAITING_REFRESH_MS : LAUNCH_REFRESH_MS,
        );
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
  // What the browser returned proves something only when the agent checked it, so it is called evidence only then.
  const readTitle = verified ? 'Evidence' : 'What was read';
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
        <ProgressChip progress={launch.progress} />
        <span className="text-[12.5px] text-muted-foreground">
          {launch.decidedAt !== undefined
            ? `Decided ${when(launch.decidedAt)}`
            : `${WAITING_FOR_PERSON.has(launch.progress) ? 'Asked' : 'Started'} ${when(launch.createdAt)}`}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13.5px]">{launch.reason}</p>
      {launch.progress === 'setup' && (
        <SetupPanel
          launch={launch}
          chosen={chosen}
          busy={busy}
          onChoose={setChosen}
          onUse={(connectorId) => void move(() => api.chooseLaunchAccount(launchId, connectorId))}
          onCancel={() => void move(() => api.cancelLaunch(launchId))}
        />
      )}
      {launch.progress === 'review' && launch.proposed !== undefined && (
        <ReviewPanel
          launch={launch}
          busy={busy}
          onStart={(digest) => void move(() => api.confirmLaunch(launchId, digest))}
          onCancel={() => void move(() => api.cancelLaunch(launchId))}
        />
      )}
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
          <h5 className="text-[13px] font-medium">{readTitle}</h5>
          <ul aria-label={readTitle} className="mt-0.5 flex list-disc flex-col gap-1 pl-5">
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

/**
 * A request waiting for setup: what is left to do, and, when the agent asks which account to use, the
 * accounts it offers by the id each has, since two can share a title. The person's choice is sent as
 * the connector's id. Cancelling is always there.
 */
function SetupPanel({
  launch,
  chosen,
  busy,
  onChoose,
  onUse,
  onCancel,
}: {
  readonly launch: ITaskLaunchStatusView;
  readonly chosen: string | undefined;
  readonly busy: boolean;
  readonly onChoose: (connectorId: string) => void;
  readonly onUse: (connectorId: string) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const steps = launch.steps ?? [];
  const offered = steps.flatMap((step) => (step.type === 'choose-account' ? step.accounts : []));
  // What the person picked counts only while the agent still offers it.
  const picked = offered.some((account) => account.id === chosen) ? chosen : undefined;
  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 && (
        <div className="text-[13px]">
          <p className="font-medium">Still to do:</p>
          <SetupSteps steps={steps} label="Steps still to do" />
        </div>
      )}
      {offered.length > 0 && (
        <div className="flex flex-col gap-1">
          <div role="radiogroup" aria-label="Account for this task" className="flex flex-col gap-1">
            {offered.map((account) => (
              <label key={account.id} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="radio"
                  name={`account-${launch.id}`}
                  value={account.id}
                  checked={picked === account.id}
                  disabled={busy}
                  onChange={() => onChoose(account.id)}
                />
                {accountLabel(account)}
              </label>
            ))}
          </div>
          <div>
            <Button disabled={busy || picked === undefined} onClick={() => onUse(picked!)}>
              Use this account
            </Button>
          </div>
        </div>
      )}
      <div>
        <Button disabled={busy} onClick={onCancel}>
          Cancel request
        </Button>
      </div>
    </div>
  );
}

/**
 * A request waiting for a look: the access it would now run on, in the agent's words, and the one
 * button that starts it on exactly that. What is sent is the digest of what is shown, so access that
 * changed after the page drew is refused and shown again instead of started.
 */
function ReviewPanel({
  launch,
  busy,
  onStart,
  onCancel,
}: {
  readonly launch: ITaskLaunchStatusView;
  readonly busy: boolean;
  readonly onStart: (reviewDigest: string) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const proposed = launch.proposed ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px]">
        <p className="font-medium">This task would use:</p>
        <ul aria-label="Access to confirm" className="list-disc pl-5">
          {proposed.map((access) => (
            <li key={`${access.capability}:${access.account ?? ''}:${access.tool ?? ''}`}>
              <span>{access.argumentBoundary}</span>
              {access.account !== undefined && (
                <span className="text-muted-foreground"> · account {access.account}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          tone="primary"
          disabled={busy || launch.reviewDigest === undefined}
          onClick={() => onStart(launch.reviewDigest!)}
        >
          Start with this access
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel request
        </Button>
      </div>
    </div>
  );
}

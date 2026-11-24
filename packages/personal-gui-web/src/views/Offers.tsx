import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../api.js';
import { LaunchStatus } from './LaunchStatus.js';
import { newestFirst, offerSource, offerTitle } from './offer-text.js';
import { READINESS, Readiness, chip } from './TaskReadiness.js';
import { TaskStart } from './TaskStart.js';
import { Button, when } from './ui.js';

import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskLaunchStatusView,
  ITaskOfferView,
  ITaskOffersView,
  TTaskOfferDecisionRequest,
} from '../api.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long the person can set an offer aside for; the agent refuses a longer wait. */
const SNOOZES = [
  { label: 'Snooze 1 day', ms: DAY_MS },
  { label: 'Snooze 1 week', ms: 7 * DAY_MS },
] as const;

const NOT_REACHED = 'Your agent could not be reached. Try again.';

/**
 * The person's decision about one offer: sent once at a time, with the agent's own words when it
 * refuses. Once the agent has taken it, the lists are read again so they show what it kept.
 */
function useDecision(
  api: IPersonalApi,
  onChanged: () => Promise<void>,
): {
  readonly busy: boolean;
  readonly problem: string | undefined;
  readonly decide: (offerId: string, request: TTaskOfferDecisionRequest) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  /** Set at once on a press, since a second press can come before the page has redrawn. */
  const sending = useRef(false);
  const decide = async (offerId: string, request: TTaskOfferDecisionRequest): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await api.decideTaskOffer(offerId, request);
      await onChanged();
    } catch (caught) {
      setProblem(caught instanceof ApiError ? caught.message : NOT_REACHED);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return { busy, problem, decide };
}

/**
 * One offer: why the agent thinks the task is worth doing, where that was read, and what the agent says
 * of the task now. Everything a source shaped (the reason, what it rests on, the item) is shown as the
 * plain text it is. Opening the card shows what the offer rests on and, for a ready task, the form to
 * start it with the offer's suggested values, which the person can change. Nothing starts until the
 * person presses Start there, and the agent judges the offer and the task again at that press.
 */
function OfferCard({
  api,
  offer,
  definition,
  launch,
  focused,
  newKey,
  onOpenGoal,
  onOpenFeed,
  onChanged,
}: {
  readonly api: IPersonalApi;
  readonly offer: ITaskOfferView;
  /** The task the offer is for, which the form to start it is made from. */
  readonly definition: ITaskDefinitionView | undefined;
  /** What the page already knows of the launch this offer made. */
  readonly launch: ITaskLaunchStatusView | undefined;
  /** The offer the person was sent to from the Feed. */
  readonly focused: boolean;
  readonly newKey: () => string;
  readonly onOpenGoal: ((goalId: string) => void) | undefined;
  readonly onOpenFeed: ((launchId: string) => void) | undefined;
  readonly onChanged: () => Promise<void>;
}): React.ReactElement {
  const titleId = `offer-${offer.id}`;
  const [expanded, setExpanded] = useState(focused);
  // A launch made from this card is shown at once, before the list has been read again.
  const [startedId, setStartedId] = useState<string | undefined>(undefined);
  const { busy, problem, decide } = useDecision(api, onChanged);
  const card = useRef<HTMLElement>(null);
  const noted = useRef(false);
  useEffect(() => {
    if (focused) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);
  // That the person opened the offer is the agent's to keep: it is told once, however long the card
  // stays open, and what it answers is not needed to show the card.
  useEffect(() => {
    if (!expanded || noted.current) return;
    noted.current = true;
    void api.taskOffer(offer.id).catch(() => undefined);
  }, [api, expanded, offer.id]);

  const launchId = startedId ?? offer.launchId;
  const started = launchId !== undefined;
  const open = offer.decision === 'open' && !started;
  const evidence = offer.evidence;
  return (
    <li>
      <article
        ref={card}
        aria-labelledby={titleId}
        aria-current={focused ? 'true' : undefined}
        className={`rounded-lg border p-3 ${focused ? 'border-primary' : 'border-border'}`}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 id={titleId} className="text-[14px] font-semibold">
            {offerTitle(offer)}
          </h3>
          {started ? (
            <span className={chip}>Started</span>
          ) : (
            offer.readiness !== undefined && (
              <span className={chip}>{READINESS[offer.readiness.state]}</span>
            )
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[14px]">{offer.reason}</p>
        <p className="mt-1 break-words text-[12.5px] text-muted-foreground">{offerSource(offer)}</p>
        {!started && offer.readiness !== undefined && <Readiness readiness={offer.readiness} />}
        {launchId !== undefined && (
          <LaunchStatus
            key={launchId}
            api={api}
            launchId={launchId}
            {...(launch?.id === launchId && { initial: launch })}
            {...(onOpenGoal !== undefined && { onOpenGoal })}
            {...(onOpenFeed !== undefined && { onOpenFeed })}
          />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button expanded={expanded} onClick={() => setExpanded((now) => !now)}>
            {expanded ? 'Hide details' : 'Show details'}
          </Button>
          {open && (
            <>
              <Button
                disabled={busy}
                onClick={() => void decide(offer.id, { decision: 'dismissed' })}
              >
                Dismiss
              </Button>
              {SNOOZES.map(({ label, ms }) => (
                <Button
                  key={label}
                  disabled={busy}
                  onClick={() =>
                    void decide(offer.id, {
                      decision: 'snoozed',
                      snoozedUntil: new Date(Date.now() + ms).toISOString(),
                    })
                  }
                >
                  {label}
                </Button>
              ))}
            </>
          )}
        </div>
        {problem !== undefined && (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {problem}
          </p>
        )}
        {expanded && (
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <dl className="flex flex-col gap-1 text-[13px]">
              {offer.basis !== undefined && (
                <div>
                  <dt className="inline font-medium">What it rests on: </dt>
                  <dd className="inline whitespace-pre-wrap break-words">{offer.basis}</dd>
                </div>
              )}
              {evidence !== undefined && (
                <>
                  <div>
                    <dt className="inline font-medium">Item: </dt>
                    <dd className="inline break-all">{evidence.sourceItemId}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Observed: </dt>
                    <dd className="inline">{when(evidence.observedAt)}</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="inline font-medium">Expires: </dt>
                <dd className="inline">{when(offer.expiresAt)}</dd>
              </div>
            </dl>
            {open && offer.readiness?.state === 'ready' && definition !== undefined && (
              <TaskStart
                api={api}
                definition={definition}
                newKey={newKey}
                offerId={offer.id}
                {...(offer.prefilled !== undefined && { suggested: offer.prefilled })}
                onStarted={(id) => {
                  setStartedId(id);
                  void onChanged();
                }}
                onRefusedAsNotReady={() => void onChanged()}
              />
            )}
          </div>
        )}
      </article>
    </li>
  );
}

/** An offer the person set aside: why, until when, and the way to bring it back. */
function SetAsideCard({
  api,
  offer,
  onChanged,
}: {
  readonly api: IPersonalApi;
  readonly offer: ITaskOfferView;
  readonly onChanged: () => Promise<void>;
}): React.ReactElement {
  const { busy, problem, decide } = useDecision(api, onChanged);
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">{offerTitle(offer)}</h3>
        <span className={chip}>
          {offer.decision === 'snoozed' && offer.snoozedUntil !== undefined
            ? `Snoozed until ${when(offer.snoozedUntil)}`
            : 'Dismissed'}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[14px]">{offer.reason}</p>
      <p className="mt-1 break-words text-[12.5px] text-muted-foreground">{offerSource(offer)}</p>
      <div className="mt-2">
        <Button disabled={busy} onClick={() => void decide(offer.id, { decision: 'open' })}>
          Reopen
        </Button>
      </div>
      {problem !== undefined && (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {problem}
        </p>
      )}
    </li>
  );
}

/**
 * What the agent suggests the person do, newest first, with the ones they set aside kept apart and
 * closed until asked for. The page decides none of it: the agent says which offers stand and how ready
 * each task is, and the person decides whether to start one, put it off or wave it away.
 */
export function OffersSection({
  api,
  listing,
  definitions,
  launches,
  focusOffer,
  newKey,
  onOpenGoal,
  onOpenFeed,
  onChanged,
}: {
  readonly api: IPersonalApi;
  readonly listing: ITaskOffersView;
  readonly definitions: readonly ITaskDefinitionView[];
  readonly launches: readonly ITaskLaunchStatusView[];
  /** The offer the person was sent to from the Feed. */
  readonly focusOffer: string | undefined;
  readonly newKey: () => string;
  readonly onOpenGoal: ((goalId: string) => void) | undefined;
  readonly onOpenFeed: ((launchId: string) => void) | undefined;
  /** Reads the offers again; it settles when they have been read. */
  readonly onChanged: () => Promise<void>;
}): React.ReactElement {
  const shown = newestFirst(listing.offers);
  const aside = newestFirst(listing.setAside);
  const [showAside, setShowAside] = useState(() => aside.some((offer) => offer.id === focusOffer));
  const gone =
    focusOffer !== undefined &&
    ![...listing.offers, ...listing.setAside].some((offer) => offer.id === focusOffer);
  return (
    <section aria-labelledby="browse-offers" className="flex flex-col gap-2">
      <h2 id="browse-offers" className="text-[15px] font-semibold">
        Suggested for you
      </h2>
      {listing.issues.map((issue) => (
        <p key={issue} className="text-[13px] text-destructive">
          {issue}
        </p>
      ))}
      {gone && (
        <p role="status" className="text-[13px] text-muted-foreground">
          That suggestion is not available any more.
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nothing is suggested right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((offer) => (
            <OfferCard
              key={offer.id}
              api={api}
              offer={offer}
              definition={definitions.find((definition) => definition.id === offer.definitionId)}
              launch={launches.find((launch) => launch.id === offer.launchId)}
              focused={offer.id === focusOffer}
              newKey={newKey}
              onOpenGoal={onOpenGoal}
              onOpenFeed={onOpenFeed}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      {aside.length > 0 && (
        <div className="flex flex-col gap-2">
          <div>
            <Button expanded={showAside} onClick={() => setShowAside((now) => !now)}>
              {`Set aside (${aside.length})`}
            </Button>
          </div>
          {showAside && (
            <ul aria-label="Set aside" className="flex flex-col gap-2">
              {aside.map((offer) => (
                <SetAsideCard key={offer.id} api={api} offer={offer} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

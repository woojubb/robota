import { useCallback, useEffect, useRef, useState } from 'react';

import { LaunchStatus } from './LaunchStatus.js';
import { OffersSection } from './Offers.js';
import { READINESS, Readiness, chip } from './TaskReadiness.js';
import { TaskStart, newStartKey } from './TaskStart.js';
import { ViewFrame, errorText } from './ui.js';

import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskInputView,
  ITaskLaunchStatusView,
  ITaskOffersView,
} from '../api.js';

/** What each operation a task needs means to the person; an operation not listed is spelled out as it is named. */
const NEEDS: Readonly<Record<string, string>> = {
  'mail.search': 'Search a connected mailbox',
  'mail.read': 'Read a message in a connected mailbox',
  'mail.draft': 'Prepare a draft message',
  'calendar.read': 'Read your calendar',
  'goals.read': 'Read your goals',
  'web.read': 'Read a web page',
};

const EFFECT = {
  'read-only': 'Only reads. It changes nothing.',
  draft: 'May prepare drafts. It sends nothing.',
  'approval-required-write': 'May make changes, each one only after you approve it.',
} as const;

const CHECKED_BY = {
  'source-readback': 'Reading the result back from where it came from.',
  receipt: 'A receipt from the service.',
  'owner-confirmation': 'Your own confirmation.',
} as const;

function needs(capability: string): string {
  const known = NEEDS[capability];
  if (known !== undefined) return known;
  const [family = '', operation = ''] = capability.split('.');
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}: ${operation.replaceAll('-', ' ')}`;
}

function asked(input: ITaskInputView): string {
  return input.required ? input.label : `${input.label} (optional)`;
}

function DefinitionCard({
  api,
  definition,
  latest,
  focusLaunch,
  newKey,
  onOpenGoal,
  onOpenFeed,
  onNotReady,
}: {
  readonly api: IPersonalApi;
  readonly definition: ITaskDefinitionView;
  /** The newest launch of this task the agent has kept, with where it stands. */
  readonly latest: ITaskLaunchStatusView | undefined;
  readonly focusLaunch: string | undefined;
  readonly newKey: () => string;
  readonly onOpenGoal: ((goalId: string) => void) | undefined;
  readonly onOpenFeed: ((launchId: string) => void) | undefined;
  readonly onNotReady: () => void;
}): React.ReactElement {
  const titleId = `task-${definition.id}`;
  // A launch started from this card is the one shown; before that, the newest one the agent has kept.
  const [startedId, setStartedId] = useState<string | undefined>(undefined);
  const shownId = startedId ?? latest?.id;
  const highlighted = focusLaunch !== undefined && focusLaunch === shownId;
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (highlighted) card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted]);
  return (
    <li>
      <article ref={card} aria-labelledby={titleId} className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h4 id={titleId} className="text-[14px] font-semibold">
            {definition.title}
          </h4>
          <span className={chip}>{READINESS[definition.readiness.state]}</span>
        </div>
        <Readiness readiness={definition.readiness} />
        <p className="mt-2 whitespace-pre-wrap text-[14px]">{definition.expectedResult}</p>
        <dl className="mt-2 flex flex-col gap-1 text-[13px]">
          <div>
            <dt className="inline font-medium">Needs: </dt>
            <dd className="inline">{definition.capabilities.map(needs).join('; ')}</dd>
          </div>
          {definition.inputs.length > 0 && (
            <div>
              <dt className="inline font-medium">Asks you for: </dt>
              <dd className="inline">{definition.inputs.map(asked).join('; ')}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">What it may do: </dt>
            <dd className="inline">{EFFECT[definition.effectCeiling]}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Success is checked by: </dt>
            <dd className="inline">
              {CHECKED_BY[definition.completionEvidence.kind]}{' '}
              {definition.completionEvidence.description}
            </dd>
          </div>
        </dl>
        {definition.startable && definition.readiness.state !== 'unavailable' && (
          <TaskStart
            api={api}
            definition={definition}
            newKey={newKey}
            needsSetup={definition.readiness.state === 'needs-setup'}
            onStarted={setStartedId}
            // A task that was shown as ready and is not is the one refusal that changes what the card says.
            onRefused={(status) => {
              if (status === 422) onNotReady();
            }}
          />
        )}
        {shownId !== undefined && (
          <LaunchStatus
            key={shownId}
            api={api}
            launchId={shownId}
            {...(shownId === latest?.id && { initial: latest })}
            highlighted={highlighted}
            {...(onOpenGoal !== undefined && { onOpenGoal })}
            {...(onOpenFeed !== undefined && { onOpenFeed })}
          />
        )}
      </article>
    </li>
  );
}

/** The definitions in the order given, grouped under their category in the order the categories first appear. */
function byCategory(
  definitions: readonly ITaskDefinitionView[],
): readonly (readonly [string, readonly ITaskDefinitionView[]])[] {
  const groups = new Map<string, ITaskDefinitionView[]>();
  for (const definition of definitions) {
    groups.set(definition.category, [...(groups.get(definition.category) ?? []), definition]);
  }
  return [...groups.entries()];
}

/**
 * Work the agent can take on, and what it suggests the person do. Each task shows the agent's own
 * word on whether it can run: ready with the access it would use, needing the setup steps named, or
 * unavailable with the reason. The page decides none of it. Only a task the agent can start and has not
 * called unavailable has a Start, and the agent judges it again when Start is pressed. A task that was started shows where it
 * stands, as the agent reports it. A task that needs setup and that the agent can start has a Start
 * that keeps the request until setup is done. A suggestion shows why it was made and where that was read, and the
 * person decides: start it from its card, put it off, or set it aside.
 */
export function BrowseView({
  api,
  onOpenGoal,
  onOpenFeed,
  focusLaunch,
  focusOffer,
  newKey = newStartKey,
}: {
  readonly api: IPersonalApi;
  /** Opens the goal a started task made, among the person's goals. */
  readonly onOpenGoal?: (goalId: string) => void;
  /** Opens the Feed to the report of a started task. */
  readonly onOpenFeed?: (launchId: string) => void;
  /** The launch whose card the person is sent to from the Feed. */
  readonly focusLaunch?: string;
  /** The offer whose card the person is sent to from the Feed; it opens there. */
  readonly focusOffer?: string;
  /** Makes the key one request to start a task goes with. */
  readonly newKey?: () => string;
}): React.ReactElement {
  const [definitions, setDefinitions] = useState<readonly ITaskDefinitionView[] | undefined>(
    undefined,
  );
  const [offers, setOffers] = useState<ITaskOffersView | undefined>(undefined);
  const [launches, setLaunches] = useState<readonly ITaskLaunchStatusView[]>([]);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [offersProblem, setOffersProblem] = useState<string | undefined>(undefined);
  // Bumped when the agent says a task it showed as ready is not, so the cards are read again.
  const [reading, setReading] = useState(0);
  /** Which read of the offers is the newest, so an answer that arrives late never replaces a newer one. */
  const offersRead = useRef(0);
  /** Reads the offers again after the person decided one or started a task from one. It never throws. */
  const refreshOffers = useCallback(async (): Promise<void> => {
    const read = (offersRead.current += 1);
    try {
      const next = await api.taskOffers();
      if (read !== offersRead.current) return;
      setOffers(next);
      setOffersProblem(undefined);
    } catch (caught) {
      if (read === offersRead.current) setOffersProblem(errorText(caught));
    }
  }, [api]);
  useEffect(() => {
    let current = true;
    const read = (offersRead.current += 1);
    void Promise.allSettled([api.taskDefinitions(), api.taskOffers(), api.taskLaunches()]).then(
      ([defined, offered, launched]) => {
        if (!current) return;
        const failed: string[] = [];
        if (defined.status === 'fulfilled') setDefinitions(defined.value);
        else failed.push(errorText(defined.reason));
        if (offered.status === 'fulfilled') {
          if (read === offersRead.current) setOffers(offered.value);
        } else failed.push(errorText(offered.reason));
        if (launched.status === 'fulfilled') setLaunches(launched.value);
        else failed.push(errorText(launched.reason));
        setErrors(failed);
      },
    );
    return () => {
      current = false;
    };
  }, [api, reading]);
  const loading = definitions === undefined && offers === undefined && errors.length === 0;
  return (
    <ViewFrame title="Browse">
      <div className="flex max-w-3xl flex-col gap-4 p-4">
        <p className="text-[13px] text-muted-foreground">
          Work your agent can take on. This list is kept on your own machine and needs no online
          catalog.
        </p>
        {loading && (
          <p role="status" className="text-[13px] text-muted-foreground">
            Loading…
          </p>
        )}
        {errors.map((message) => (
          <p key={message} role="alert" className="text-[13px] text-destructive">
            {message}
          </p>
        ))}
        {offersProblem !== undefined && (
          <p role="alert" className="text-[13px] text-destructive">
            {offersProblem}
          </p>
        )}
        {offers !== undefined && (
          <OffersSection
            api={api}
            listing={offers}
            definitions={definitions ?? []}
            launches={launches}
            focusOffer={focusOffer}
            newKey={newKey}
            onOpenGoal={onOpenGoal}
            onOpenFeed={onOpenFeed}
            onChanged={refreshOffers}
          />
        )}
        {definitions !== undefined && (
          <section aria-labelledby="browse-tasks" className="flex flex-col gap-3">
            <h2 id="browse-tasks" className="text-[15px] font-semibold">
              Tasks
            </h2>
            {byCategory(definitions).map(([category, group], index) => (
              <section key={category} aria-labelledby={`browse-category-${index}`}>
                <h3
                  id={`browse-category-${index}`}
                  className="pb-1 text-[13px] font-medium text-muted-foreground"
                >
                  {category}
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.map((definition) => (
                    <DefinitionCard
                      key={definition.id}
                      api={api}
                      definition={definition}
                      latest={launches.find((launch) => launch.definitionId === definition.id)}
                      focusLaunch={focusLaunch}
                      newKey={newKey}
                      onOpenGoal={onOpenGoal}
                      onOpenFeed={onOpenFeed}
                      onNotReady={() => setReading((count) => count + 1)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </section>
        )}
      </div>
    </ViewFrame>
  );
}

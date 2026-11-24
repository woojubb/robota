import { useEffect, useState } from 'react';

import { ViewFrame, errorText, when } from './ui.js';

import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskInputView,
  ITaskOfferView,
  ITaskOffersView,
  TTaskReadinessView,
  TTaskSetupStepView,
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

const SOURCE = {
  'built-in': 'Built in',
  owner: 'Added by you',
  agent: 'Suggested by your agent',
} as const;

const DECISION = {
  open: '',
  dismissed: 'Dismissed',
  accepted: 'Accepted',
  expired: 'Expired',
  superseded: 'Replaced by a newer offer',
} as const;

function needs(capability: string): string {
  const known = NEEDS[capability];
  if (known !== undefined) return known;
  const [family = '', operation = ''] = capability.split('.');
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}: ${operation.replaceAll('-', ' ')}`;
}

const READINESS = {
  ready: 'Ready',
  'needs-setup': 'Needs setup',
  unavailable: 'Unavailable',
} as const;

const SERVICE = {
  mail: 'a mail service',
  calendar: 'a calendar service',
  files: 'a file service',
  chat: 'a chat service',
  notes: 'a notes service',
  other: 'a service',
} as const;

/** What the person does for one step, in plain words. The names in it are shown as the text they are. */
function stepText(step: TTaskSetupStepView): string {
  switch (step.type) {
    case 'connect':
      return `Connect ${SERVICE[step.kind]}`;
    case 'choose-account':
      return `Choose which account to use: ${step.accounts.map((account) => account.title).join(', ')}`;
    case 'allow-tool':
      return `Allow the tool ${step.tool} for ${step.connectorTitle}${
        step.decision === 'write' ? ' (each change still waits for your approval)' : ''
      }`;
    case 'reconnect':
      return `Reconnect ${step.connectorTitle}`;
  }
}

function Readiness({
  readiness,
}: {
  readonly readiness: TTaskReadinessView;
}): React.ReactElement | null {
  switch (readiness.state) {
    case 'unavailable':
      return <p className="mt-1 text-[12.5px] text-muted-foreground">{readiness.reason}</p>;
    case 'needs-setup':
      return (
        <div className="mt-1 text-[13px]">
          <p className="font-medium">To get this ready:</p>
          <ul aria-label="Setup steps" className="list-disc pl-5">
            {readiness.steps.map((step) => (
              <li key={stepText(step)}>{stepText(step)}</li>
            ))}
          </ul>
        </div>
      );
    case 'ready':
      return (
        <div className="mt-1 text-[13px]">
          <p className="font-medium">Access</p>
          <ul aria-label="Access" className="list-disc pl-5">
            {readiness.accesses.map((access) => (
              <li key={access}>{access}</li>
            ))}
          </ul>
        </div>
      );
  }
}

function asked(input: ITaskInputView): string {
  return input.required ? input.label : `${input.label} (optional)`;
}

const chip =
  'rounded-full border border-border px-2 py-0.5 text-[12px] font-medium text-muted-foreground';

function DefinitionCard({
  definition,
}: {
  readonly definition: ITaskDefinitionView;
}): React.ReactElement {
  const titleId = `task-${definition.id}`;
  return (
    <li>
      <article aria-labelledby={titleId} className="rounded-lg border border-border p-3">
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
      </article>
    </li>
  );
}

/** An offer's reason can come from a mail or a page, so it is shown as text and nothing else. */
function OfferCard({ offer }: { readonly offer: ITaskOfferView }): React.ReactElement {
  const decision = DECISION[offer.decision];
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">
          {offer.withdrawn ? 'A task that is no longer in the catalog' : offer.definitionTitle}
        </h3>
        {decision !== '' && <span className={chip}>{decision}</span>}
        {offer.withdrawn && <span className={chip}>Withdrawn</span>}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[14px]">{offer.reason}</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {SOURCE[offer.source]} · {offer.decision === 'expired' ? 'Expired' : 'Expires'}{' '}
        {when(offer.expiresAt)}
      </p>
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
 * Work the agent can take on, and what has been offered to the person. Each task shows the agent's own
 * word on whether it can run: ready with the access it would use, needing the setup steps named, or
 * unavailable with the reason. The page decides none of it, and nothing here starts anything.
 */
export function BrowseView({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const [definitions, setDefinitions] = useState<readonly ITaskDefinitionView[] | undefined>(
    undefined,
  );
  const [offers, setOffers] = useState<ITaskOffersView | undefined>(undefined);
  const [errors, setErrors] = useState<readonly string[]>([]);
  useEffect(() => {
    let current = true;
    void Promise.allSettled([api.taskDefinitions(), api.taskOffers()]).then(
      ([defined, offered]) => {
        if (!current) return;
        const failed: string[] = [];
        if (defined.status === 'fulfilled') setDefinitions(defined.value);
        else failed.push(errorText(defined.reason));
        if (offered.status === 'fulfilled') setOffers(offered.value);
        else failed.push(errorText(offered.reason));
        setErrors(failed);
      },
    );
    return () => {
      current = false;
    };
  }, [api]);
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
        {offers !== undefined && (
          <section aria-labelledby="browse-offers" className="flex flex-col gap-2">
            <h2 id="browse-offers" className="text-[15px] font-semibold">
              Offers for you
            </h2>
            {offers.issues.map((issue) => (
              <p key={issue} className="text-[13px] text-destructive">
                {issue}
              </p>
            ))}
            {offers.offers.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No offers yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {offers.offers.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </ul>
            )}
          </section>
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
                    <DefinitionCard key={definition.id} definition={definition} />
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

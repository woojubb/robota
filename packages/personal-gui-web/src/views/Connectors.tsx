import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass, when } from './ui.js';

import type {
  IConnectorCatalogView,
  IConnectorToolView,
  IConnectorView,
  IConnectorsListing,
  IDisconnectAnswer,
  IDisconnectView,
  IPersonalApi,
  TConnectorAuth,
  TConnectorKind,
  TConnectorState,
  TToolAccess,
} from '../api.js';

const REFRESH_MS = 3_000;

/** What the long-lasting sign-in choice asks of a service that ends sign-ins after about an hour. */
const LONG_LASTING: Readonly<Record<string, string>> = {
  access_type: 'offline',
  prompt: 'consent',
};

const KINDS: readonly TConnectorKind[] = ['mail', 'calendar', 'files', 'chat', 'notes', 'other'];

const AUTH_CHOICES: readonly { readonly value: TConnectorAuth; readonly label: string }[] = [
  { value: 'oauth', label: 'Sign in on the service’s own page' },
  { value: 'token', label: 'Paste a token or API key' },
  { value: 'none', label: 'No sign-in needed' },
];

const STATE_LABEL: Readonly<Record<TConnectorState, string>> = {
  'not-connected': 'Not connected',
  connecting: 'Waiting for you to sign in',
  connected: 'Connected',
  'needs-sign-in': 'Needs you to sign in again',
  failed: 'Could not connect',
};

/** What a person can do about a sign-in that failed for a reason that is theirs to act on. */
const FAILURE_HELP: Readonly<Record<string, string>> = {
  'registration-unavailable':
    'This service does not register clients automatically. Register a client with it yourself (the add form shows the redirect address to allow), then remove this connector and add it again with that client id.',
  'client-metadata-unusable':
    'This service takes a client description published at an address, but the one this agent was given cannot be used: it could not be read, is not this agent’s, or does not list this page’s redirect address. Whoever runs this agent can fix the address, or you can register a client with the service yourself.',
};

/** The state in words; a token the service stopped accepting asks for a new token, not a sign-in. */
function stateLabel(connector: IConnectorView): string {
  if (connector.auth === 'token' && connector.status.state === 'needs-sign-in') {
    return 'The service no longer accepts the token';
  }
  return STATE_LABEL[connector.status.state];
}

/** What disconnecting did at the service, and in the library, in words the person can act on. */
function outcomeText(answer: IDisconnectAnswer, auth: TConnectorAuth): string {
  const forgotten =
    answer.forgotten === undefined || answer.forgotten === 0
      ? ''
      : ` ${answer.forgotten} ${answer.forgotten === 1 ? 'fact it had pulled was' : 'facts it had pulled were'} forgotten.`;
  return `${revocationText(answer.outcome, auth)}${forgotten}`;
}

function revocationText(outcome: IDisconnectView, auth: TConnectorAuth): string {
  switch (outcome.revocation) {
    case 'revoked':
      return 'Disconnected. The service confirmed it revoked the access.';
    case 'partial':
      return 'Disconnected. The service revoked part of the access; the rest ends when it expires.';
    case 'unsupported':
      return auth === 'token'
        ? 'Disconnected, and your agent deleted the token. The service keeps the token valid until you revoke it there.'
        : 'Disconnected here. The service offers no way to revoke, so the access ends when it expires.';
    case 'failed':
      return 'Disconnected here, but the service did not confirm the revocation; the access ends when it expires.';
    case 'not-attempted':
      return 'Disconnected. There was no access to revoke.';
  }
}

const SYNC_CHOICES: readonly { readonly minutes: number | null; readonly label: string }[] = [
  { minutes: null, label: 'Off' },
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 1440, label: 'Every day' },
];

const DECISIONS: readonly { readonly value: TToolAccess | 'default'; readonly label: string }[] = [
  { value: 'default', label: 'What the service says' },
  { value: 'read', label: 'Treat as reading' },
  { value: 'write', label: 'Ask me every time' },
  { value: 'blocked', label: 'Never allow' },
];

function ToolRow({
  tool,
  onDecide,
}: {
  readonly tool: IConnectorToolView;
  readonly onDecide: (decision: TToolAccess | null) => void;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12.5px]">{tool.name}</p>
        {tool.description !== undefined && (
          <p className="truncate text-[12px] text-muted-foreground">{tool.description}</p>
        )}
      </div>
      <select
        aria-label={`What ${tool.name} may do`}
        className="rounded-md border border-border bg-background px-1.5 py-1 text-[12.5px]"
        value={tool.decision ?? 'default'}
        onChange={(event) =>
          onDecide(event.target.value === 'default' ? null : (event.target.value as TToolAccess))
        }
      >
        {DECISIONS.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </li>
  );
}

function ToolGroup({
  title,
  note,
  tools,
  onDecide,
}: {
  readonly title: string;
  readonly note: string;
  readonly tools: readonly IConnectorToolView[];
  readonly onDecide: (tool: string, decision: TToolAccess | null) => void;
}): React.ReactElement | null {
  if (tools.length === 0) return null;
  return (
    <section aria-label={title} className="mt-2">
      <h3 className="text-[13px] font-semibold">
        {title} <span className="font-normal text-muted-foreground">— {note}</span>
      </h3>
      <ul className="divide-y divide-border">
        {tools.map((tool) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            onDecide={(decision) => onDecide(tool.name, decision)}
          />
        ))}
      </ul>
    </section>
  );
}

/** The longest text the agent keeps as what to ask about; it refuses a longer one, this only stops typing. */
const ATTENTION_MAX = 600;

/** Words as the agent keeps them: one line, so a saved text compares equal to what the page shows. */
const collapsed = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * What the person wants to be asked about, in their own words: the text a check reads before it
 * looks at the service. It shows what applies (their words, or the default for this kind), saves
 * plain text, and says plainly whether the agent kept it or refused it.
 */
function AttentionEditor({
  connector,
  onSave,
}: {
  readonly connector: IConnectorView;
  /** Keep this text, or the default when it is empty; rejects with the reason it was refused. */
  readonly onSave: (text: string) => Promise<void>;
}): React.ReactElement {
  const effective = connector.attention ?? connector.defaultAttention;
  const [draft, setDraft] = useState(effective);
  const [outcome, setOutcome] = useState<
    { readonly refused: boolean; readonly text: string } | undefined
  >(undefined);
  const [saving, setSaving] = useState(false);
  // The list reloads every few seconds: what the person is typing is never overwritten, and what
  // changed elsewhere shows once they have nothing unsaved.
  const shown = useRef(effective);
  useEffect(() => {
    setDraft((current) => (collapsed(current) === collapsed(shown.current) ? effective : current));
    shown.current = effective;
  }, [effective]);
  const save = async (text: string, done: string): Promise<void> => {
    setSaving(true);
    try {
      await onSave(text);
      setOutcome({ refused: false, text: done });
      if (collapsed(text) === '') setDraft(connector.defaultAttention);
    } catch (caught) {
      setOutcome({ refused: true, text: errorText(caught) });
    } finally {
      setSaving(false);
    }
  };
  const field = `attention-${connector.id}`;
  return (
    <div className="mt-3 border-t border-border pt-2">
      <label htmlFor={field} className="text-[13px] font-semibold">
        What should I ask you about?
      </label>
      <p className="text-[12px] text-muted-foreground">
        Each check reads these words first and asks you only about what fits them.{' '}
        {connector.attention === undefined
          ? `These are the default words for ${connector.kind}; change them to say what matters to you.`
          : 'These are your own words.'}
      </p>
      <textarea
        id={field}
        className={`${inputClass} mt-1`}
        rows={3}
        maxLength={ATTENTION_MAX}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setOutcome(undefined);
        }}
      />
      <div className="mt-1 flex items-center gap-2">
        <Button
          tone="primary"
          disabled={saving || collapsed(draft) === effective}
          onClick={() => void save(draft, 'Saved. The next check uses these words.')}
        >
          Save
        </Button>
        <Button
          disabled={saving}
          onClick={() => void save('', 'Back to the default words.')}
          label={`Use the default words for ${connector.title}`}
        >
          Use the default
        </Button>
        <span
          role="status"
          className={`min-w-0 flex-1 text-[12.5px] ${outcome?.refused === true ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {outcome?.text}
        </span>
      </div>
    </div>
  );
}

function ConnectorCard({
  connector,
  onConnect,
  onDisconnect,
  onRemove,
  onDecide,
  onSync,
  onRunSync,
  onSaveAttention,
  pulledCount,
}: {
  readonly connector: IConnectorView;
  readonly onConnect: (typed?: { clientSecret?: string; token?: string }) => void;
  readonly onDisconnect: (forgetPulled: boolean) => void;
  readonly onRemove: (forgetPulled: boolean) => void;
  readonly onDecide: (tool: string, decision: TToolAccess | null) => void;
  readonly onSync: (everyMinutes: number | null) => void;
  readonly onRunSync: () => void;
  readonly onSaveAttention: (text: string) => Promise<void>;
  /** How many library claims this connector put there. */
  readonly pulledCount: () => Promise<number>;
}): React.ReactElement {
  const { status } = connector;
  const auth = connector.auth ?? 'oauth';
  // What the person types for one sign-in (a client secret, or the token of a service that takes
  // one): held here until the request goes, never stored.
  const [typed, setTyped] = useState('');
  const connect = (): void => {
    const value = typed;
    setTyped('');
    if (value === '') onConnect();
    else onConnect(auth === 'token' ? { token: value } : { clientSecret: value });
  };
  const idle = status.state !== 'connected' && status.state !== 'connecting';
  const asksClientSecret = idle && auth === 'oauth' && connector.oauth?.clientId !== undefined;
  const asksToken = idle && auth === 'token';
  // What the person is being asked, and how much of the library the connector filled.
  const [asking, setAsking] = useState<
    { kind: 'disconnect' | 'remove'; pulled: number } | undefined
  >(undefined);
  const ask = async (kind: 'disconnect' | 'remove'): Promise<void> => {
    const pulled = await pulledCount().catch(() => 0);
    if (kind === 'disconnect' && pulled === 0) onDisconnect(false);
    else setAsking({ kind, pulled });
  };
  const finish = (forget: boolean): void => {
    if (asking?.kind === 'remove') onRemove(forget);
    else onDisconnect(forget);
    setAsking(undefined);
  };
  const tools = connector.tools ?? [];
  return (
    <li className="rounded-lg border border-border p-3" aria-label={connector.title}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[14px] font-semibold">{connector.title}</h2>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11.5px] text-muted-foreground">
          {connector.kind}
        </span>
        <span
          className={`ml-auto text-[12.5px] ${status.state === 'connected' ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {stateLabel(connector)}
          {status.state === 'failed' && status.reason !== undefined ? ` (${status.reason})` : ''}
        </span>
      </div>
      <p className="break-all text-[12px] text-muted-foreground">{connector.endpoint}</p>
      {status.state === 'failed' &&
        status.reason !== undefined &&
        FAILURE_HELP[status.reason] !== undefined && (
          <p className="mt-1 text-[12.5px]">{FAILURE_HELP[status.reason]}</p>
        )}
      {auth === 'none' && (
        <p className="text-[12px] text-muted-foreground">This service needs no sign-in.</p>
      )}
      {status.state === 'connected' && status.scope !== undefined && (
        <p className="mt-1 break-words text-[12.5px]">
          <span className="text-muted-foreground">The service says you allowed: </span>
          <span className="font-mono">{status.scope}</span>
        </p>
      )}
      {status.state === 'connecting' && status.authorizationUrl !== undefined && (
        <p className="mt-2 text-[13px]">
          <a
            href={status.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            Open the sign-in page
          </a>{' '}
          <span className="text-muted-foreground">
            in this browser, sign in once and allow access; this page updates when you are back.
          </span>
        </p>
      )}
      {status.state === 'connected' && (
        <>
          {tools.length === 0 && (
            <p className="mt-2 text-[13px] text-muted-foreground">This service offers no tools.</p>
          )}
          <ToolGroup
            title="Reads"
            note="your agent may use these on its own"
            tools={tools.filter((tool) => tool.access === 'read')}
            onDecide={onDecide}
          />
          <ToolGroup
            title="Writes"
            note="anything that changes or sends waits for your approval, every time"
            tools={tools.filter((tool) => tool.access === 'write')}
            onDecide={onDecide}
          />
          <ToolGroup
            title="Blocked"
            note="never used"
            tools={tools.filter((tool) => tool.access === 'blocked')}
            onDecide={onDecide}
          />
        </>
      )}
      {status.state === 'connected' && (
        <section aria-label="Keep up to date" className="mt-3 border-t border-border pt-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold">Keep your library up to date</h3>
            <select
              aria-label={`How often to check ${connector.title}`}
              className="ml-auto rounded-md border border-border bg-background px-1.5 py-1 text-[12.5px]"
              value={String(connector.sync?.everyMinutes ?? 'off')}
              onChange={(event) =>
                onSync(event.target.value === 'off' ? null : Number(event.target.value))
              }
            >
              <option value="off">Off</option>
              {SYNC_CHOICES.filter((choice) => choice.minutes !== null).map((choice) => (
                <option key={choice.minutes} value={String(choice.minutes)}>
                  {choice.label}
                </option>
              ))}
              {connector.sync !== undefined &&
                !SYNC_CHOICES.some((choice) => choice.minutes === connector.sync?.everyMinutes) && (
                  <option value={String(connector.sync.everyMinutes)}>
                    Every {connector.sync.everyMinutes} minutes
                  </option>
                )}
            </select>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Each check reads the service and files the facts worth keeping in your Library, marked
            with where they came from. It cannot change anything at the service.
          </p>
          {connector.sync !== undefined && (
            <p className="mt-1 flex items-center gap-2 text-[12.5px]">
              <span>
                Last checked: {when(connector.sync.lastRunAt)}.{' '}
                {connector.sync.status === 'paused'
                  ? 'Paused in your Goals: Check now runs it once and starts it again.'
                  : connector.sync.status === 'running' || connector.sync.status === 'waiting'
                    ? 'Checking now.'
                    : `Next: ${when(connector.sync.nextRunAt)}.`}
              </span>
              <Button onClick={onRunSync}>Check now</Button>
            </p>
          )}
          <AttentionEditor connector={connector} onSave={onSaveAttention} />
        </section>
      )}
      {asksClientSecret && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Type the client secret again for each sign-in: this page does not keep it.
        </p>
      )}
      {asksToken && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Paste the token the service gave you. Your agent keeps it in an owner-only file and does
          not show it again.{' '}
          {connector.tokenHeader === undefined
            ? 'It is sent as a bearer token.'
            : `It is sent in the ${connector.tokenHeader} header.`}
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {asksClientSecret && (
          <input
            type="password"
            autoComplete="new-password"
            aria-label={`Client secret for ${connector.title}, if the service gave you one`}
            placeholder="Client secret (if given)"
            className={`${inputClass} w-56`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
        {asksToken && (
          <input
            type="password"
            autoComplete="new-password"
            aria-label={`Token for ${connector.title}`}
            placeholder="Token"
            className={`${inputClass} w-56`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
        {idle && (
          <Button tone="primary" onClick={connect} disabled={asksToken && typed.trim() === ''}>
            {status.state === 'not-connected' ? 'Connect' : 'Connect again'}
          </Button>
        )}
        {status.state === 'connecting' && <Button onClick={() => onConnect()}>Start over</Button>}
        {status.state === 'connected' && auth !== 'none' && asking === undefined && (
          <Button onClick={() => void ask('disconnect')}>Disconnect</Button>
        )}
        <span className="ml-auto flex items-center gap-2">
          {asking !== undefined ? (
            <>
              <span role="status" className="text-[12.5px] text-muted-foreground">
                {asking.kind === 'remove' ? 'Remove and revoke access?' : 'Disconnect?'}
                {asking.pulled > 0 &&
                  ` ${asking.pulled} ${asking.pulled === 1 ? 'fact' : 'facts'} in your Library came from it.`}
              </span>
              {asking.pulled > 0 ? (
                <>
                  <Button tone="danger" onClick={() => finish(true)}>
                    {asking.kind === 'remove'
                      ? 'Remove and forget them'
                      : 'Disconnect and forget them'}
                  </Button>
                  <Button tone="danger" onClick={() => finish(false)}>
                    {asking.kind === 'remove' ? 'Remove, keep them' : 'Disconnect, keep them'}
                  </Button>
                </>
              ) : (
                <Button tone="danger" onClick={() => finish(false)}>
                  Yes, remove
                </Button>
              )}
              <Button onClick={() => setAsking(undefined)}>Cancel</Button>
            </>
          ) : (
            <Button onClick={() => void ask('remove')}>Remove</Button>
          )}
        </span>
      </div>
    </li>
  );
}

function AddForm({
  redirectUri,
  search,
  onAdd,
  onCancel,
}: {
  readonly redirectUri: string;
  readonly search: (query: string) => Promise<IConnectorCatalogView>;
  readonly onAdd: (input: {
    title: string;
    kind: TConnectorKind;
    endpoint: string;
    auth?: TConnectorAuth;
    tokenHeader?: string;
    clientId?: string;
    scopes?: readonly string[];
    authorizationParams?: Readonly<Record<string, string>>;
  }) => Promise<void>;
  readonly onCancel: () => void;
}): React.ReactElement {
  // Suggestions are values to fill in below; nothing is added until the person presses Add.
  const [query, setQuery] = useState('');
  // What was found, and for which words: an answer that arrives after a newer search is dropped.
  const [found, setFound] = useState<
    { readonly view: IConnectorCatalogView; readonly query: string } | undefined
  >(undefined);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const newest = useRef(0);
  const runSearch = async (): Promise<void> => {
    newest.current += 1;
    const mine = newest.current;
    const asked = query;
    setSearchError(undefined);
    try {
      const view = await search(asked);
      if (mine === newest.current) setFound({ view, query: asked });
    } catch (caught) {
      if (mine !== newest.current) return;
      setFound(undefined);
      setSearchError(errorText(caught));
    }
  };
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TConnectorKind>('mail');
  const [endpoint, setEndpoint] = useState('');
  const [auth, setAuth] = useState<TConnectorAuth>('oauth');
  const [tokenHeader, setTokenHeader] = useState('');
  const [clientId, setClientId] = useState('');
  const [scopes, setScopes] = useState('');
  const [stayIn, setStayIn] = useState(false);
  // Sign-in options a suggestion brought that the checkbox does not stand for; shown, never hidden.
  const [suggestedParams, setSuggestedParams] = useState<
    Readonly<Record<string, string>> | undefined
  >(undefined);
  return (
    <form
      aria-label="Add a connector"
      className="flex max-w-xl flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const words = scopes.split(/\s+/u).filter((word) => word !== '');
        // What belongs to another way of signing in is left out, so a field the person filled and then
        // hid by changing the choice is never sent.
        const oauth = auth === 'oauth';
        void onAdd({
          title,
          kind,
          endpoint,
          ...(!oauth && { auth }),
          ...(auth === 'token' && tokenHeader.trim() !== '' && { tokenHeader: tokenHeader.trim() }),
          ...(oauth && clientId.trim() !== '' && { clientId: clientId.trim() }),
          ...(oauth && words.length > 0 && { scopes: words }),
          ...(oauth &&
            (stayIn || suggestedParams !== undefined) && {
              // What the note says the suggestion asks for always wins; the long-lasting box only adds the
              // pair keys the suggestion does not set.
              authorizationParams: { ...(stayIn && LONG_LASTING), ...suggestedParams },
            }),
        });
      }}
    >
      <section aria-label="Find a service" className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            aria-label="Search for a service"
            placeholder="Search for a service to connect"
            className={`${inputClass} flex-1`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter searches; it must not submit the form below and add something.
              if (event.key === 'Enter') {
                event.preventDefault();
                void runSearch();
              }
            }}
          />
          <Button onClick={() => void runSearch()}>Search</Button>
        </div>
        {searchError !== undefined && <Notice tone="error">{searchError}</Notice>}
        {found?.view.registry === 'unreachable' && (
          <p className="text-[12.5px] text-muted-foreground">
            The public registry could not be reached, so only your own list is shown.
          </p>
        )}
        {found !== undefined && found.view.entries.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">
            Nothing found. You can still type the service’s address below.
          </p>
        )}
        {found !== undefined && found.view.entries.length > 0 && (
          <>
            <p className="text-[12.5px] font-medium">
              {found.query === '' ? 'Suggestions' : `Results for “${found.query}”`}
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Anyone can list a service in the registry: check that you trust one before you add it.
              Choosing one only fills in the form below.
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {found.view.entries.map((entry) => (
                <li key={entry.endpoint} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{entry.title}</p>
                    {entry.description !== undefined && (
                      <p className="truncate text-[12px] text-muted-foreground">
                        {entry.description}
                      </p>
                    )}
                    <p className="truncate text-[12px] text-muted-foreground">
                      {new URL(entry.endpoint).hostname} ·{' '}
                      {AUTH_CHOICES.find((choice) => choice.value === entry.auth)?.label} ·{' '}
                      {entry.source === 'file' ? 'your list' : 'public registry'}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setTitle(entry.title);
                      setKind(entry.kind);
                      setEndpoint(entry.endpoint);
                      setAuth(entry.auth);
                      setTokenHeader(entry.tokenHeader ?? '');
                      setClientId(entry.oauth?.clientId ?? '');
                      setScopes((entry.oauth?.scopes ?? []).join(' '));
                      const params = entry.oauth?.authorizationParams;
                      const longLasting =
                        params !== undefined &&
                        Object.keys(params).length === 2 &&
                        params['access_type'] === 'offline' &&
                        params['prompt'] === 'consent';
                      setStayIn(longLasting);
                      setSuggestedParams(longLasting ? undefined : params);
                    }}
                  >
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <label className="flex flex-col gap-1 text-[13px]">
        Name
        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        What it is
        <select
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as TConnectorKind)}
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        Address of the service
        <input
          className={inputClass}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://…"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        How it signs you in
        <select
          className={inputClass}
          value={auth}
          onChange={(event) => setAuth(event.target.value as TConnectorAuth)}
        >
          {AUTH_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {auth === 'token' && (
        <label className="flex flex-col gap-1 text-[13px]">
          Header the token goes in (optional)
          <input
            className={inputClass}
            value={tokenHeader}
            onChange={(e) => setTokenHeader(e.target.value)}
            placeholder="Authorization, as a bearer token, when left empty"
          />
          <span className="text-[12.5px] text-muted-foreground">
            You paste the token itself on the card after adding, not here.
          </span>
        </label>
      )}
      {auth === 'oauth' && (
        <>
          <label className="flex flex-col gap-1 text-[13px]">
            Client id you registered (optional)
            <input
              className={inputClass}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Scopes to ask for, separated by spaces (optional)
            <input
              className={inputClass}
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-1"
              checked={stayIn}
              onChange={(event) => setStayIn(event.target.checked)}
            />
            <span>
              Ask the service for a long-lasting sign-in
              <span className="block text-[12.5px] text-muted-foreground">
                Some services end a sign-in after about an hour unless you ask for this when you
                sign in. It asks you to agree again.
              </span>
            </span>
          </label>
          {suggestedParams !== undefined && (
            <p className="text-[12.5px] text-muted-foreground">
              This suggestion also asks the service for:{' '}
              <span className="font-mono">
                {Object.entries(suggestedParams)
                  .map(([name, value]) => `${name}=${value}`)
                  .join(', ')}
              </span>
            </p>
          )}
          <p className="text-[12.5px] text-muted-foreground">
            If the service needs a client you registered yourself, register this redirect address
            with it:
            <br />
            <span className="break-all font-mono">{redirectUri}</span>
          </p>
        </>
      )}
      <div className="flex gap-2">
        <Button type="submit" tone="primary">
          Add
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * The services the person connected: sign in once in this browser, see what the agent may do with
 * each, and disconnect. The page never holds a credential; it shows a fixed state word, and the
 * agent decides what a tool may do.
 */
export function ConnectorsView({ api }: { readonly api: IPersonalApi }): React.ReactElement {
  const [listing, setListing] = useState<IConnectorsListing | undefined>(undefined);
  // Why the list could not be loaded (cleared by the next load that works) and why the person's last
  // action was refused (kept until they act again, so a refusal is not wiped by the reload after it).
  const [error, setError] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(async () => {
    try {
      setListing(await api.connectors());
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
  const run = async (work: () => Promise<void>): Promise<void> => {
    setRefusal(undefined);
    try {
      await work();
    } catch (caught) {
      setRefusal(errorText(caught));
    }
    await reload();
  };
  const redirectUri = `${window.location.origin}${listing?.callbackPath ?? '/connector-callback'}`;
  return (
    <ViewFrame
      title="Connectors"
      actions={!adding && <Button onClick={() => setAdding(true)}>Add a connector</Button>}
    >
      {error !== undefined && <Notice tone="error">{error}</Notice>}
      {refusal !== undefined && <Notice tone="error">{refusal}</Notice>}
      {message !== undefined && <Notice>{message}</Notice>}
      {adding && (
        <AddForm
          redirectUri={redirectUri}
          search={(query) => api.connectorCatalog(query)}
          onCancel={() => setAdding(false)}
          onAdd={(input) =>
            run(async () => {
              await api.addConnector(input);
              setAdding(false);
            })
          }
        />
      )}
      {listing !== undefined && listing.connectors.length === 0 && !adding && (
        <Notice>
          Nothing connected yet. Add a service such as your mail, calendar or notes; you sign in
          once, and your agent can then read it for you. Anything it would change or send waits for
          your approval.
        </Notice>
      )}
      <ul className="flex max-w-3xl flex-col gap-3 p-4">
        {(listing?.connectors ?? []).map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            onConnect={(typed) =>
              void run(async () => {
                setMessage(undefined);
                // Only an OAuth sign-in comes back to this page, so only it sends the page's address.
                const { status } = await api.connectConnector(connector.id, {
                  ...((connector.auth ?? 'oauth') === 'oauth' && {
                    origin: window.location.origin,
                  }),
                  ...typed,
                });
                // Opened for the person in this browser; the link on the card does the same if a
                // pop-up blocker stops it.
                if (status.authorizationUrl !== undefined) {
                  window.open(status.authorizationUrl, '_blank', 'noopener,noreferrer');
                }
              })
            }
            onDisconnect={(forget) =>
              void run(async () => {
                setMessage(
                  outcomeText(
                    await api.disconnectConnector(connector.id, forget),
                    connector.auth ?? 'oauth',
                  ),
                );
              })
            }
            onRemove={(forget) =>
              void run(async () => {
                setMessage(
                  outcomeText(
                    await api.removeConnector(connector.id, forget),
                    connector.auth ?? 'oauth',
                  ),
                );
              })
            }
            pulledCount={async () => (await api.connectorPulled(connector.id)).count}
            onSync={(everyMinutes) =>
              void run(async () => {
                await api.setConnectorSync(connector.id, everyMinutes);
              })
            }
            onRunSync={() =>
              void run(async () => {
                if (connector.sync === undefined) return;
                await api.goalAction(connector.sync.goalId, 'run');
                setMessage(
                  'Queued. The check starts shortly; its report comes to your Feed if it has something to tell.',
                );
              })
            }
            onSaveAttention={async (text) => {
              // The editor shows the refusal beside its own buttons, so it is not a refusal of the page.
              await api.setConnectorAttention(connector.id, text);
              await reload();
            }}
            onDecide={(tool, decision) =>
              void run(async () => {
                await api.decideConnectorTool(connector.id, tool, decision);
              })
            }
          />
        ))}
      </ul>
    </ViewFrame>
  );
}

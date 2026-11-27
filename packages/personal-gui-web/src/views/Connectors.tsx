import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api.js';
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
const LIST_TIMEOUT_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 75_000;

async function scopeRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = LIST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('The case settings request took too long'));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

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
  checking: 'Checking connection',
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

/** Give every tool name an unambiguous spelling, including spaces and non-ASCII characters. */
function visibleToolName(name: string): string {
  return name.replace(/[^!-~]|\\/gu, (character) =>
    character === '\\' ? '\\\\' : `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );
}

function CaseActions({
  connector,
  unavailable,
  ready,
  supported,
  onChange,
  onReset,
  onRefresh,
  onFinishDisconnect,
  onCancelPending,
}: {
  readonly connector: IConnectorView;
  readonly unavailable: boolean;
  readonly ready: boolean;
  readonly supported: boolean;
  readonly onChange: (tool: string, allowed: boolean) => Promise<void>;
  readonly onReset: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onFinishDisconnect: () => void;
  readonly onCancelPending: () => Promise<void>;
}): React.ReactElement | null {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(new Map<symbol, 'allow' | 'revoke' | 'cancel' | 'other'>());
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  if (
    !supported ||
    connector.caseActionTools === undefined ||
    (connector.caseActionRevision === undefined && connector.caseActionScopeError !== true)
  )
    return null;

  const identity = `${connector.title} (${connector.id})`;
  const allowed = connector.caseActionTools;
  const writable = (connector.tools ?? []).filter((tool) => tool.access === 'write');
  const names = [...new Set([...writable.map((tool) => tool.name), ...allowed])];
  const change = async (
    work: () => Promise<void>,
    kind: 'allow' | 'revoke' | 'cancel' | 'other',
  ): Promise<void> => {
    if (
      inFlight.current.size > 0 &&
      !(
        (kind === 'revoke' || kind === 'cancel') &&
        [...inFlight.current.values()].every((entry) => entry === 'allow')
      )
    )
      return;
    const token = Symbol();
    inFlight.current.set(token, kind);
    setSaving(true);
    setRefusal(undefined);
    try {
      await work();
    } catch (caught) {
      setRefusal(errorText(caught));
    } finally {
      inFlight.current.delete(token);
      setSaving(inFlight.current.size > 0);
    }
  };
  return (
    <section
      aria-label={`Case requests for ${identity}`}
      className="mt-3 border-t border-border pt-2"
    >
      <h3 className="text-[13px] font-semibold">Case requests</h3>
      <p className="text-[12px] text-muted-foreground">
        A case you connect to this service can request these tools after your next answer. You must
        approve each action separately. Reconnecting clears these choices; select them again after
        sign-in.
      </p>
      {!ready && connector.caseActionChangePending !== true && (
        <p className="mt-1 text-[12.5px] text-destructive">
          Case settings are not confirmed yet. Reset any unreadable settings and wait for this page
          to reconnect.
        </p>
      )}
      {unavailable && (
        <div className="mt-1">
          <p role="alert" className="text-[12.5px] text-destructive">
            The change could not be confirmed. Retry to settle it before changing these settings.
          </p>
          <Button
            disabled={saving}
            label={`Settle case request settings for ${identity}`}
            onClick={() => void change(onRefresh, 'other')}
          >
            Settle settings
          </Button>
        </div>
      )}
      {connector.caseActionChangePending === true && (
        <div className="mt-1">
          <p className="text-[12.5px] text-muted-foreground">
            A new choice is being confirmed. You can remove an existing choice or cancel the pending
            change.
          </p>
          <Button
            disabled={saving && ![...inFlight.current.values()].every((entry) => entry === 'allow')}
            label={`Cancel pending choice for ${identity}`}
            onClick={() => void change(onCancelPending, 'cancel')}
          >
            Cancel pending choice
          </Button>
        </div>
      )}
      {connector.caseActionScopeError === true ? (
        <div className="mt-2">
          {connector.caseActionTransition === true && (
            <div>
              <p className="text-[12.5px] text-destructive">
                A connection change has not finished. If it was interrupted, disconnect again before
                using case settings. If this still fails, stop every agent using the state folder
                and follow the case-request recovery instructions in the Personal Agent guide.
              </p>
              <Button label={`Finish disconnecting ${identity}`} onClick={onFinishDisconnect}>
                Finish disconnect
              </Button>
            </div>
          )}
          <p className="text-[12.5px] text-destructive">
            These settings could not be confirmed. Resetting removes all allowed tools for this
            connector.
          </p>
          <Button
            disabled={saving || connector.caseActionRevision === undefined}
            label={`Reset case request settings for ${identity}`}
            onClick={() => void change(onReset, 'other')}
          >
            Reset case request settings
          </Button>
        </div>
      ) : names.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">
          {connector.status.state === 'connected'
            ? 'There are no writable tools to select.'
            : connector.status.state === 'checking'
              ? 'Checking which tools can be selected.'
              : 'Connect this service to select writable tools.'}
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {names.map((name) => {
            const checked = allowed.includes(name);
            const label = visibleToolName(name);
            const mayAllow =
              connector.status.state === 'connected' && writable.some((tool) => tool.name === name);
            const mayInterrupt =
              checked &&
              saving &&
              [...inFlight.current.values()].every((entry) => entry === 'allow');
            return (
              <li key={name}>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    aria-label={`Allow ${label} for case requests on ${identity}`}
                    checked={checked}
                    disabled={
                      (saving && !mayInterrupt) ||
                      unavailable ||
                      (!ready && !(connector.caseActionChangePending === true && checked)) ||
                      (!checked && (!mayAllow || connector.caseActionChangePending === true))
                    }
                    onChange={(event) => {
                      const next = event.target.checked;
                      void change(() => onChange(name, next), next ? 'allow' : 'revoke');
                    }}
                  />
                  <span className="break-all font-mono">{label}</span>
                  {!mayAllow && (
                    <span className="text-muted-foreground">
                      — unavailable; you can remove access
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {refusal !== undefined && (
        <p role="alert" className="mt-1 text-[12.5px] text-destructive">
          {refusal}
        </p>
      )}
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
  onReplaceToken,
  onRemove,
  onDecide,
  onSync,
  onRunSync,
  onSaveAttention,
  onCaseAction,
  onResetCaseActions,
  onRefreshCaseActions,
  onCancelPendingCaseAction,
  unavailable,
  scopeReady,
  scopeSupported,
  pulledCount,
}: {
  readonly connector: IConnectorView;
  readonly onConnect: (typed?: { clientSecret?: string; token?: string }) => void;
  readonly onDisconnect: (forgetPulled: boolean) => void;
  /** Try a new token in place of the one in use; the page keeps nothing of it. */
  readonly onReplaceToken: (token: string) => void;
  readonly onRemove: (forgetPulled: boolean) => void;
  readonly onDecide: (tool: string, decision: TToolAccess | null) => void;
  readonly onSync: (everyMinutes: number | null) => void;
  readonly onRunSync: () => void;
  readonly onSaveAttention: (text: string) => Promise<void>;
  readonly onCaseAction: (tool: string, allowed: boolean) => Promise<void>;
  readonly onResetCaseActions: () => Promise<void>;
  readonly onRefreshCaseActions: () => Promise<void>;
  readonly onCancelPendingCaseAction: () => Promise<void>;
  readonly unavailable: boolean;
  readonly scopeReady: boolean;
  readonly scopeSupported: boolean;
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
  // A new token typed over the one in use: held here until the request goes, then cleared.
  const [replacement, setReplacement] = useState('');
  const replace = (): void => {
    const value = replacement;
    setReplacement('');
    onReplaceToken(value);
  };
  const idle =
    status.state !== 'connected' && status.state !== 'connecting' && status.state !== 'checking';
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
    <li
      className="rounded-lg border border-border p-3"
      aria-label={`${connector.title} (${connector.id})`}
    >
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
      <p className="break-all text-[12px] text-muted-foreground">Service ID: {connector.id}</p>
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
      <CaseActions
        connector={connector}
        unavailable={unavailable}
        ready={scopeReady}
        supported={scopeSupported}
        onChange={onCaseAction}
        onReset={onResetCaseActions}
        onRefresh={onRefreshCaseActions}
        onFinishDisconnect={() => onDisconnect(false)}
        onCancelPending={onCancelPendingCaseAction}
      />
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
      {status.state === 'connected' && auth === 'token' && (
        <section aria-label="Replace token" className="mt-3 border-t border-border pt-2">
          <h3 className="text-[13px] font-semibold">Replace the token</h3>
          <p className="text-[12px] text-muted-foreground">
            Paste a new token. Your agent tries it first and uses it only if the service accepts it;
            until then it keeps using the token it has, and nothing is disconnected.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="password"
              autoComplete="new-password"
              aria-label={`New token for ${connector.title}`}
              placeholder="New token"
              className={`${inputClass} w-56`}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
            <Button onClick={replace} disabled={replacement.trim() === ''}>
              Replace token
            </Button>
          </div>
        </section>
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
  const [scopeStartError, setScopeStartError] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [scopeReady, setScopeReady] = useState<ReadonlySet<string>>(new Set());
  const [initialFenceDone, setInitialFenceDone] = useState(false);
  const [scopeSupported, setScopeSupported] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const requestNumber = useRef(0);
  const listPending = useRef(false);
  const listAbort = useRef<AbortController | undefined>(undefined);
  const legacyServer = useRef(false);
  const appliedRequest = useRef(0);
  const scopeRevisions = useRef(new Map<string, number>());
  const viewRevisions = useRef(new Map<string, number>());
  const viewObservations = useRef(new Map<string, string>());
  const pendingViews = useRef(new Map<string, number>());
  const inventoryRevision = useRef(0);
  const inventoryPending = useRef(false);
  const scopeObservations = useRef(new Map<string, { key: string; serial: number }>());
  const displayedScopes = useRef(new Map<string, string>());
  const openingScopes = useRef(new Set<string>());
  const viewingConnectors = useRef(new Map<string, number>());
  const refreshingScopes = useRef(new Set<string>());
  const savingScopes = useRef(new Map<string, number>());
  const viewedAt = useRef(new Map<string, number>());
  const openedAt = useRef(new Map<string, number>());
  const refreshedAt = useRef(new Map<string, number>());
  const pendingErrors = useRef(new Map<string, string>());
  const scopeRecovery = useRef(
    new Map<
      string,
      {
        readonly fence: () => Promise<{ connector: IConnectorView }>;
        pending?: Promise<void>;
      }
    >(),
  );
  const [uncertainScopes, setUncertainScopes] = useState<ReadonlySet<string>>(new Set());
  const scopeKey = (connector: IConnectorView): string =>
    `${connector.caseActionRevision ?? ''}:${connector.caseActionScopeError === true}:${connector.caseActionTransition === true}:${connector.caseActionChangePending === true}`;
  const readScope = async (id: string): Promise<IConnectorView> => {
    return (await scopeRequest((signal) => api.connectorCaseActionScope(id, signal))).connector;
  };
  const advanceScope = (id: string): void => {
    scopeRevisions.current.set(id, (scopeRevisions.current.get(id) ?? 0) + 1);
  };
  const advanceView = (id: string): void => {
    viewRevisions.current.set(id, (viewRevisions.current.get(id) ?? 0) + 1);
  };
  const withScope = (view: IConnectorView, scoped: IConnectorView): IConnectorView => {
    const {
      caseActionTools: _tools,
      caseActionRevision: _revision,
      caseActionScopeError: _error,
      caseActionTransition: _transition,
      caseActionChangePending: _pending,
      ...rest
    } = view;
    return {
      ...rest,
      ...(scoped.caseActionTools !== undefined && { caseActionTools: scoped.caseActionTools }),
      ...(scoped.caseActionRevision !== undefined && {
        caseActionRevision: scoped.caseActionRevision,
      }),
      ...(scoped.caseActionScopeError === true && { caseActionScopeError: true }),
      ...(scoped.caseActionTransition === true && { caseActionTransition: true }),
      ...(scoped.caseActionChangePending === true && { caseActionChangePending: true }),
    };
  };
  const viewKey = (view: IConnectorView): string => {
    const {
      caseActionTools: _tools,
      caseActionRevision: _revision,
      caseActionScopeError: _error,
      caseActionTransition: _transition,
      caseActionChangePending: _pending,
      ...rest
    } = view;
    return JSON.stringify(rest);
  };
  const applyView = (connector: IConnectorView): void => {
    advanceView(connector.id);
    viewObservations.current.set(connector.id, viewKey(connector));
    setListing((current) =>
      current === undefined
        ? current
        : {
            ...current,
            connectors: current.connectors.map((item) =>
              item.id === connector.id ? withScope(connector, item) : item,
            ),
          },
    );
  };
  const replaceConnector = (connector: IConnectorView): void => {
    displayedScopes.current.set(connector.id, scopeKey(connector));
    setListing((current) =>
      current === undefined
        ? current
        : {
            ...current,
            connectors: current.connectors.map((item) => {
              if (item.id !== connector.id) return item;
              return withScope(item, connector);
            }),
          },
    );
  };
  const confirmScope = (id: string): void => {
    setUncertainScopes((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const settleScope = async (
    id: string,
    initial: IConnectorView,
    observedAtStart: number,
    current: () => boolean,
    done: (connector: IConnectorView) => void,
  ): Promise<boolean> => {
    let candidate = initial;
    let observed = observedAtStart;
    for (;;) {
      const latest = scopeObservations.current.get(id);
      if (
        latest !== undefined &&
        latest.serial !== observed &&
        latest.key !== scopeKey(candidate)
      ) {
        observed = latest.serial;
        candidate = await readScope(id);
        continue;
      }
      if (!current()) return false;
      advanceScope(id);
      replaceConnector(candidate);
      done(candidate);
      return true;
    }
  };
  const reload = useCallback(async () => {
    if (listPending.current) return false;
    listPending.current = true;
    const request = ++requestNumber.current;
    const revisions = new Map(scopeRevisions.current);
    const views = new Map(viewRevisions.current);
    const inventoryAtStart = inventoryRevision.current;
    const controller = new AbortController();
    listAbort.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const next = await Promise.race([
        api.connectors(controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => {
              reject(new Error('The connector list took too long to load'));
              controller.abort();
            },
            legacyServer.current ? DISCOVERY_TIMEOUT_MS : LIST_TIMEOUT_MS,
          );
        }),
      ]);
      if (request > appliedRequest.current) {
        appliedRequest.current = request;
        const preserve = new Set<string>();
        const preserveViews = new Set<string>();
        for (const item of next.connectors) {
          const view = viewKey(item);
          if (viewObservations.current.get(item.id) !== view) {
            viewObservations.current.set(item.id, view);
            if (pendingViews.current.has(item.id)) advanceView(item.id);
          }
          if (
            views.get(item.id) !== viewRevisions.current.get(item.id) ||
            pendingViews.current.has(item.id)
          )
            preserveViews.add(item.id);
          else advanceView(item.id);
          const key = scopeKey(item);
          const last = scopeObservations.current.get(item.id);
          if (last?.key !== key) {
            scopeObservations.current.set(item.id, { key, serial: (last?.serial ?? 0) + 1 });
          }
          const pending = scopeRecovery.current.has(item.id) || openingScopes.current.has(item.id);
          const error =
            item.caseActionScopeError === true
              ? `error:${item.caseActionRevision ?? ''}`
              : undefined;
          const newError =
            pending && error !== undefined && pendingErrors.current.get(item.id) !== error;
          if (
            revisions.get(item.id) !== scopeRevisions.current.get(item.id) ||
            (pending && !newError)
          ) {
            preserve.add(item.id);
          } else {
            if (newError) pendingErrors.current.set(item.id, error);
            if (!pending && error === undefined) pendingErrors.current.delete(item.id);
            if (newError)
              scopeRevisions.current.set(item.id, (scopeRevisions.current.get(item.id) ?? 0) + 1);
            displayedScopes.current.set(item.id, key);
          }
        }
        const inventoryChanged = inventoryAtStart !== inventoryRevision.current;
        if (!inventoryChanged) inventoryRevision.current += 1;
        setListing((current) =>
          current === undefined
            ? next
            : {
                ...next,
                connectors: next.connectors
                  .filter(
                    (item) =>
                      !inventoryChanged ||
                      current.connectors.some((previous) => previous.id === item.id),
                  )
                  .map((item) => {
                    const previous = current.connectors.find(
                      (candidate) => candidate.id === item.id,
                    );
                    if (previous === undefined) return item;
                    const view = preserveViews.has(item.id) ? previous : item;
                    return withScope(view, preserve.has(item.id) ? previous : item);
                  })
                  .concat(
                    inventoryChanged
                      ? current.connectors.filter(
                          (item) => !next.connectors.some((candidate) => candidate.id === item.id),
                        )
                      : [],
                  ),
              },
        );
        setError(undefined);
        return true;
      }
    } catch (caught) {
      if (request > appliedRequest.current) {
        appliedRequest.current = request;
        setError(errorText(caught));
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (listAbort.current === controller) listAbort.current = undefined;
      listPending.current = false;
    }
    return false;
  }, [api]);
  const recoverScope = (id: string): Promise<void> => {
    const recovery = scopeRecovery.current.get(id);
    if (recovery === undefined) return Promise.resolve();
    if (recovery.pending !== undefined) return recovery.pending;
    const started = scopeRevisions.current.get(id);
    const observed = scopeObservations.current.get(id)?.serial ?? 0;
    const pending = Promise.resolve()
      .then(() => recovery.fence())
      .then(async ({ connector }) => {
        await settleScope(
          id,
          connector,
          observed,
          () =>
            scopeRecovery.current.get(id) === recovery &&
            scopeRevisions.current.get(id) === started,
          () => {
            scopeRecovery.current.delete(id);
            pendingErrors.current.delete(id);
            confirmScope(id);
          },
        );
      })
      .finally(() => {
        recovery.pending = undefined;
      });
    recovery.pending = pending;
    return pending;
  };
  const saveScope = async (
    id: string,
    work: () => Promise<{ connector: IConnectorView }>,
    fence: () => Promise<{ connector: IConnectorView }>,
  ): Promise<void> => {
    advanceScope(id);
    savingScopes.current.set(id, (savingScopes.current.get(id) ?? 0) + 1);
    const started = scopeRevisions.current.get(id);
    const observed = scopeObservations.current.get(id)?.serial ?? 0;
    try {
      const result = await work();
      const applied = await settleScope(
        id,
        result.connector,
        observed,
        () => scopeRevisions.current.get(id) === started,
        () => {
          scopeRecovery.current.delete(id);
          pendingErrors.current.delete(id);
          confirmScope(id);
        },
      );
      if (!applied) {
        scopeRecovery.current.set(id, { fence });
        setUncertainScopes((current) => new Set([...current, id]));
        void recoverScope(id).catch(() => undefined);
        return;
      }
    } catch (caught) {
      advanceScope(id);
      scopeRecovery.current.set(id, { fence });
      setUncertainScopes((current) => new Set([...current, id]));
      // A failed request can still arrive later. A conditional fence settles its revision without
      // changing a newer setting made by another page.
      void recoverScope(id).catch(() => undefined);
      throw caught;
    } finally {
      const count = (savingScopes.current.get(id) ?? 1) - 1;
      if (count === 0) savingScopes.current.delete(id);
      else savingScopes.current.set(id, count);
    }
  };
  useEffect(() => {
    let active = true;
    let ready = false;
    let starting = false;
    const refreshInventory = async (): Promise<void> => {
      if (inventoryPending.current) return;
      inventoryPending.current = true;
      const started = inventoryRevision.current;
      try {
        const result = await scopeRequest((signal) => api.connectorInventory(signal));
        if (!active || started !== inventoryRevision.current || !Array.isArray(result.connectors))
          return;
        inventoryRevision.current += 1;
        const ids = new Set(result.connectors.map((item) => item.id));
        setListing((current) =>
          current === undefined
            ? result
            : {
                callbackPath: result.callbackPath,
                connectors: [
                  ...current.connectors.filter((item) => ids.has(item.id)),
                  ...result.connectors.filter(
                    (item) => !current.connectors.some((known) => known.id === item.id),
                  ),
                ],
              },
        );
      } catch {
        // A discovery-independent retry follows on the next tick.
      } finally {
        inventoryPending.current = false;
      }
    };
    const tick = async (): Promise<void> => {
      if (!ready) {
        if (starting) return;
        starting = true;
        const observed = new Map(
          [...scopeObservations.current].map(([id, value]) => [id, value.serial]),
        );
        try {
          const result = await scopeRequest((signal) => api.fenceCaseActionRequests(signal));
          if (
            !Array.isArray(result.fenced) ||
            !result.fenced.every((id) => typeof id === 'string') ||
            !Array.isArray(result.connectors) ||
            typeof result.callbackPath !== 'string'
          ) {
            throw new Error('Case settings could not be confirmed');
          }
          if (!active) return;
          const conflicts = new Set<string>();
          for (const connector of result.connectors) {
            const last = scopeObservations.current.get(connector.id);
            if (
              last !== undefined &&
              last.serial !== (observed.get(connector.id) ?? 0) &&
              last.key !== scopeKey(connector)
            ) {
              conflicts.add(connector.id);
            } else if (last?.key !== scopeKey(connector)) {
              scopeObservations.current.set(connector.id, {
                key: scopeKey(connector),
                serial: (last?.serial ?? 0) + 1,
              });
            }
            if (!conflicts.has(connector.id)) {
              displayedScopes.current.set(connector.id, scopeKey(connector));
            }
            advanceScope(connector.id);
          }
          setListing((current) => ({
            callbackPath: result.callbackPath,
            connectors: [
              ...result.connectors.map((item) =>
                conflicts.has(item.id)
                  ? (current?.connectors.find((previous) => previous.id === item.id) ?? item)
                  : item,
              ),
              ...(current?.connectors.filter(
                (previous) => !result.connectors.some((item) => item.id === previous.id),
              ) ?? []),
            ],
          }));
          ready = true;
          setScopeStartError(undefined);
          setScopeSupported(true);
          setScopeReady(new Set(result.fenced.filter((id) => !conflicts.has(id))));
          setInitialFenceDone(true);
          void reload();
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 404) {
            ready = true;
            legacyServer.current = true;
            if (active) {
              setScopeSupported(false);
              setScopeStartError(undefined);
            }
          } else if (active) {
            setScopeStartError(errorText(caught));
          }
          if (active) await reload();
        } finally {
          starting = false;
        }
        return;
      }
      if (active && ready) await reload();
    };
    void tick();
    const timer = setInterval(() => {
      setRetryTick((current) => current + 1);
      if (active && ready) void refreshInventory();
      void tick();
    }, REFRESH_MS);
    return () => {
      active = false;
      listAbort.current?.abort();
      clearInterval(timer);
    };
  }, [api, reload]);
  useEffect(() => {
    if (!initialFenceDone || !scopeSupported || listing === undefined) return;
    for (const item of listing.connectors) {
      if (
        viewedAt.current.get(item.id) !== retryTick &&
        (!viewingConnectors.current.has(item.id) ||
          viewingConnectors.current.get(item.id) !== (viewRevisions.current.get(item.id) ?? 0))
      ) {
        viewedAt.current.set(item.id, retryTick);
        const generation = viewRevisions.current.get(item.id) ?? 0;
        viewingConnectors.current.set(item.id, generation);
        const viewStarted = viewRevisions.current.get(item.id);
        void scopeRequest((signal) => api.connector(item.id, signal), DISCOVERY_TIMEOUT_MS)
          .then(({ connector }) => {
            if (pendingViews.current.has(item.id)) {
              const key = viewKey(connector);
              if (viewObservations.current.get(item.id) !== key) {
                viewObservations.current.set(item.id, key);
                advanceView(item.id);
              }
            } else if (viewStarted === viewRevisions.current.get(item.id)) {
              applyView(connector);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (viewingConnectors.current.get(item.id) === generation)
              viewingConnectors.current.delete(item.id);
          });
      }
      if (
        scopeReady.has(item.id) ||
        openingScopes.current.has(item.id) ||
        openedAt.current.get(item.id) === retryTick
      )
        continue;
      openedAt.current.set(item.id, retryTick);
      openingScopes.current.add(item.id);
      const revision = scopeRevisions.current.get(item.id);
      const observed = scopeObservations.current.get(item.id)?.serial ?? 0;
      void scopeRequest((signal) => api.openConnectorCaseActions(item.id, signal))
        .then(async ({ connector }) => {
          await settleScope(
            item.id,
            connector,
            observed,
            () => scopeRevisions.current.get(item.id) === revision,
            () => {
              pendingErrors.current.delete(item.id);
              setScopeReady((current) => new Set([...current, item.id]));
            },
          );
        })
        .catch(() => undefined)
        .finally(() => {
          openingScopes.current.delete(item.id);
        });
    }
  }, [api, initialFenceDone, listing, retryTick, scopeReady, scopeSupported]);
  useEffect(() => {
    if (!initialFenceDone || !scopeSupported || listing === undefined) return;
    for (const item of listing.connectors) {
      if (
        !scopeReady.has(item.id) ||
        refreshingScopes.current.has(item.id) ||
        refreshedAt.current.get(item.id) === retryTick
      )
        continue;
      refreshedAt.current.set(item.id, retryTick);
      refreshingScopes.current.add(item.id);
      const revision = scopeRevisions.current.get(item.id);
      const observed = scopeObservations.current.get(item.id)?.serial ?? 0;
      void readScope(item.id)
        .then(async (connector) => {
          const key = scopeKey(connector);
          const last = scopeObservations.current.get(item.id);
          if (last?.key === key && displayedScopes.current.get(item.id) === key) return;
          const observe = (applied: IConnectorView): void => {
            const previous = scopeObservations.current.get(item.id);
            const appliedKey = scopeKey(applied);
            if (previous?.key !== appliedKey) {
              scopeObservations.current.set(item.id, {
                key: appliedKey,
                serial: (previous?.serial ?? 0) + 1,
              });
            }
          };
          if (scopeRecovery.current.has(item.id)) {
            const error =
              connector.caseActionScopeError === true
                ? `error:${connector.caseActionRevision ?? ''}`
                : undefined;
            if (error !== undefined && pendingErrors.current.get(item.id) !== error)
              await settleScope(
                item.id,
                connector,
                observed,
                () =>
                  scopeRevisions.current.get(item.id) === revision &&
                  scopeRecovery.current.has(item.id),
                (applied) => {
                  if (applied.caseActionScopeError === true)
                    pendingErrors.current.set(item.id, `error:${applied.caseActionRevision ?? ''}`);
                  observe(applied);
                },
              );
            return;
          }
          await settleScope(
            item.id,
            connector,
            observed,
            () => scopeRevisions.current.get(item.id) === revision,
            observe,
          );
        })
        .catch(() => undefined)
        .finally(() => {
          refreshingScopes.current.delete(item.id);
        });
    }
  }, [api, initialFenceDone, listing, retryTick, scopeReady, scopeSupported]);
  const run = async (
    work: (current: () => boolean) => Promise<void>,
    id?: string,
  ): Promise<void> => {
    setRefusal(undefined);
    if (id !== undefined) {
      advanceView(id);
      pendingViews.current.set(id, (pendingViews.current.get(id) ?? 0) + 1);
    }
    const started = id === undefined ? undefined : viewRevisions.current.get(id);
    inventoryRevision.current += 1;
    try {
      await work(() => id === undefined || viewRevisions.current.get(id) === started);
    } catch (caught) {
      setRefusal(errorText(caught));
    } finally {
      if (id !== undefined) {
        if (viewRevisions.current.get(id) === started) advanceView(id);
        const count = (pendingViews.current.get(id) ?? 1) - 1;
        if (count === 0) {
          pendingViews.current.delete(id);
          setRetryTick((value) => value + 1);
        } else pendingViews.current.set(id, count);
      }
      inventoryRevision.current += 1;
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
      {scopeStartError !== undefined && <Notice tone="error">{scopeStartError}</Notice>}
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
            unavailable={uncertainScopes.has(connector.id)}
            scopeReady={scopeReady.has(connector.id)}
            scopeSupported={scopeSupported}
            onConnect={(typed) =>
              void run(async (current) => {
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
                if (current())
                  setListing((listing) =>
                    listing === undefined
                      ? listing
                      : {
                          ...listing,
                          connectors: listing.connectors.map((item) =>
                            item.id === connector.id ? { ...item, status } : item,
                          ),
                        },
                  );
              }, connector.id)
            }
            onDisconnect={(forget) =>
              void run(async (current) => {
                setMessage(
                  outcomeText(
                    await api.disconnectConnector(connector.id, forget),
                    connector.auth ?? 'oauth',
                  ),
                );
                if (current())
                  setListing((listing) =>
                    listing === undefined
                      ? listing
                      : {
                          ...listing,
                          connectors: listing.connectors.map((item) =>
                            item.id === connector.id
                              ? { ...item, status: { state: 'not-connected' }, tools: undefined }
                              : item,
                          ),
                        },
                  );
              }, connector.id)
            }
            onReplaceToken={(token) =>
              void run(async (current) => {
                setMessage(undefined);
                const answer = await api.replaceConnectorToken(connector.id, token);
                if (answer.replaced) {
                  setMessage(
                    'The new token works and is now used. Choose again which tools case requests may use.',
                  );
                } else {
                  setRefusal(
                    `The service refused the new token (${answer.reason ?? 'rejected'}). Your agent still uses the token it had.`,
                  );
                }
                // A refused replacement leaves the card as it was: the old token still works.
                if (answer.replaced && current())
                  setListing((listing) =>
                    listing === undefined
                      ? listing
                      : {
                          ...listing,
                          connectors: listing.connectors.map((item) =>
                            item.id === connector.id ? { ...item, status: answer.status } : item,
                          ),
                        },
                  );
              }, connector.id)
            }
            onRemove={(forget) =>
              void run(async () => {
                setMessage(
                  outcomeText(
                    await api.removeConnector(connector.id, forget),
                    connector.auth ?? 'oauth',
                  ),
                );
                setListing((current) =>
                  current === undefined
                    ? current
                    : {
                        ...current,
                        connectors: current.connectors.filter((item) => item.id !== connector.id),
                      },
                );
              }, connector.id)
            }
            pulledCount={async () => (await api.connectorPulled(connector.id)).count}
            onSync={(everyMinutes) =>
              void run(async (current) => {
                const result = await api.setConnectorSync(connector.id, everyMinutes);
                if (current()) applyView(result.connector);
              }, connector.id)
            }
            onRunSync={() =>
              void run(async () => {
                if (connector.sync === undefined) return;
                await api.goalAction(connector.sync.goalId, 'run');
                setMessage(
                  'Queued. The check starts shortly; its report comes to your Feed if it has something to tell.',
                );
              }, connector.id)
            }
            onSaveAttention={async (text) => {
              // The editor shows the refusal beside its own buttons, so it is not a refusal of the page.
              advanceView(connector.id);
              pendingViews.current.set(
                connector.id,
                (pendingViews.current.get(connector.id) ?? 0) + 1,
              );
              const started = viewRevisions.current.get(connector.id);
              inventoryRevision.current += 1;
              try {
                const result = await api.setConnectorAttention(connector.id, text);
                if (viewRevisions.current.get(connector.id) === started)
                  applyView(result.connector);
              } finally {
                if (viewRevisions.current.get(connector.id) === started) advanceView(connector.id);
                const count = (pendingViews.current.get(connector.id) ?? 1) - 1;
                if (count === 0) {
                  pendingViews.current.delete(connector.id);
                  setRetryTick((value) => value + 1);
                } else pendingViews.current.set(connector.id, count);
                inventoryRevision.current += 1;
                await reload();
              }
            }}
            onCaseAction={async (tool, allowed) => {
              await saveScope(
                connector.id,
                () =>
                  scopeRequest(
                    (signal) =>
                      api.setConnectorCaseAction(
                        connector.id,
                        tool,
                        allowed,
                        connector.caseActionRevision!,
                        signal,
                      ),
                    allowed ? DISCOVERY_TIMEOUT_MS : LIST_TIMEOUT_MS,
                  ),
                () =>
                  scopeRequest((signal) =>
                    api.fenceConnectorCaseActions(
                      connector.id,
                      connector.caseActionRevision!,
                      signal,
                    ),
                  ),
              );
            }}
            onResetCaseActions={async () => {
              await saveScope(
                connector.id,
                () =>
                  scopeRequest((signal) =>
                    api.resetConnectorCaseActions(
                      connector.id,
                      connector.caseActionRevision!,
                      signal,
                    ),
                  ),
                () =>
                  scopeRequest((signal) =>
                    api.fenceConnectorCaseActions(
                      connector.id,
                      connector.caseActionRevision!,
                      signal,
                    ),
                  ),
              );
            }}
            onRefreshCaseActions={() => recoverScope(connector.id)}
            onCancelPendingCaseAction={async () => {
              const fence = () =>
                scopeRequest((signal) =>
                  api.fenceConnectorCaseActions(
                    connector.id,
                    connector.caseActionRevision!,
                    signal,
                  ),
                );
              await saveScope(connector.id, fence, fence);
            }}
            onDecide={(tool, decision) =>
              void run(async (current) => {
                const result = await api.decideConnectorTool(connector.id, tool, decision);
                if (current()) applyView(result.connector);
                if (
                  !openingScopes.current.has(connector.id) &&
                  !savingScopes.current.has(connector.id) &&
                  !scopeRecovery.current.has(connector.id)
                ) {
                  const started = scopeRevisions.current.get(connector.id);
                  const observed = scopeObservations.current.get(connector.id)?.serial ?? 0;
                  try {
                    const scope = await readScope(connector.id);
                    await settleScope(
                      connector.id,
                      scope,
                      observed,
                      () =>
                        scopeRevisions.current.get(connector.id) === started &&
                        !savingScopes.current.has(connector.id) &&
                        !openingScopes.current.has(connector.id),
                      () => undefined,
                    );
                  } catch {
                    // The independent scope refresh will retry.
                  }
                }
              }, connector.id)
            }
          />
        ))}
      </ul>
    </ViewFrame>
  );
}

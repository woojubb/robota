import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, ViewFrame, errorText, inputClass } from './ui.js';

import type {
  IConnectorToolView,
  IConnectorView,
  IConnectorsListing,
  IDisconnectView,
  IPersonalApi,
  TConnectorKind,
  TConnectorState,
  TToolAccess,
} from '../api.js';

const REFRESH_MS = 3_000;

const KINDS: readonly TConnectorKind[] = ['mail', 'calendar', 'files', 'chat', 'notes', 'other'];

const STATE_LABEL: Readonly<Record<TConnectorState, string>> = {
  'not-connected': 'Not connected',
  connecting: 'Waiting for you to sign in',
  connected: 'Connected',
  'needs-sign-in': 'Needs you to sign in again',
  failed: 'Could not connect',
};

/** What disconnecting did at the service, in words the person can act on. */
function outcomeText(outcome: IDisconnectView): string {
  switch (outcome.revocation) {
    case 'revoked':
      return 'Disconnected. The service confirmed it revoked the access.';
    case 'partial':
      return 'Disconnected. The service revoked part of the access; the rest ends when it expires.';
    case 'unsupported':
      return 'Disconnected here. The service offers no way to revoke, so the access ends when it expires.';
    case 'failed':
      return 'Disconnected here, but the service did not confirm the revocation; the access ends when it expires.';
    case 'not-attempted':
      return 'Disconnected. There was no access to revoke.';
  }
}

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

function ConnectorCard({
  connector,
  onConnect,
  onDisconnect,
  onRemove,
  onDecide,
}: {
  readonly connector: IConnectorView;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRemove: () => void;
  readonly onDecide: (tool: string, decision: TToolAccess | null) => void;
}): React.ReactElement {
  const { status } = connector;
  const [confirmRemove, setConfirmRemove] = useState(false);
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
          {STATE_LABEL[status.state]}
          {status.state === 'failed' && status.reason !== undefined ? ` (${status.reason})` : ''}
        </span>
      </div>
      <p className="break-all text-[12px] text-muted-foreground">{connector.endpoint}</p>
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
      <div className="mt-3 flex items-center gap-2">
        {status.state !== 'connected' && status.state !== 'connecting' && (
          <Button tone="primary" onClick={onConnect}>
            {status.state === 'not-connected' ? 'Connect' : 'Connect again'}
          </Button>
        )}
        {status.state === 'connecting' && <Button onClick={onConnect}>Start over</Button>}
        {status.state === 'connected' && <Button onClick={onDisconnect}>Disconnect</Button>}
        <span className="ml-auto flex items-center gap-2">
          {confirmRemove ? (
            <>
              <span className="text-[12.5px] text-muted-foreground">Remove and revoke access?</span>
              <Button tone="danger" onClick={onRemove}>
                Yes, remove
              </Button>
              <Button onClick={() => setConfirmRemove(false)}>Keep</Button>
            </>
          ) : (
            <Button onClick={() => setConfirmRemove(true)}>Remove</Button>
          )}
        </span>
      </div>
    </li>
  );
}

function AddForm({
  redirectUri,
  onAdd,
  onCancel,
}: {
  readonly redirectUri: string;
  readonly onAdd: (input: {
    title: string;
    kind: TConnectorKind;
    endpoint: string;
    clientId?: string;
    scopes?: readonly string[];
  }) => Promise<void>;
  readonly onCancel: () => void;
}): React.ReactElement {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<TConnectorKind>('mail');
  const [endpoint, setEndpoint] = useState('');
  const [clientId, setClientId] = useState('');
  const [scopes, setScopes] = useState('');
  return (
    <form
      aria-label="Add a connector"
      className="flex max-w-xl flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const words = scopes.split(/\s+/u).filter((word) => word !== '');
        void onAdd({
          title,
          kind,
          endpoint,
          ...(clientId.trim() !== '' && { clientId: clientId.trim() }),
          ...(words.length > 0 && { scopes: words }),
        });
      }}
    >
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
        Client id you registered (optional)
        <input
          className={inputClass}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        Scopes to ask for, separated by spaces (optional)
        <input className={inputClass} value={scopes} onChange={(e) => setScopes(e.target.value)} />
      </label>
      <p className="text-[12.5px] text-muted-foreground">
        If the service needs a client you registered yourself, register this redirect address with
        it:
        <br />
        <span className="break-all font-mono">{redirectUri}</span>
      </p>
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
  const [error, setError] = useState<string | undefined>(undefined);
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
    try {
      await work();
    } catch (caught) {
      setError(errorText(caught));
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
      {message !== undefined && <Notice>{message}</Notice>}
      {adding && (
        <AddForm
          redirectUri={redirectUri}
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
            onConnect={() =>
              void run(async () => {
                setMessage(undefined);
                const { status } = await api.connectConnector(connector.id, window.location.origin);
                // Opened for the person in this browser; the link on the card does the same if a
                // pop-up blocker stops it.
                if (status.authorizationUrl !== undefined) {
                  window.open(status.authorizationUrl, '_blank', 'noopener,noreferrer');
                }
              })
            }
            onDisconnect={() =>
              void run(async () => {
                setMessage(outcomeText((await api.disconnectConnector(connector.id)).outcome));
              })
            }
            onRemove={() =>
              void run(async () => {
                setMessage(outcomeText((await api.removeConnector(connector.id)).outcome));
              })
            }
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

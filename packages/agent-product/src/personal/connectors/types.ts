/**
 * Connectors: external services the person connected once (mail, calendar, files, chat, notes, ...)
 * that the agent reads on demand and keeps in sync. A connector is data — a kind, an endpoint and the
 * person's decisions about its tools — and a protocol port reaches it. Nothing here holds a
 * credential or knows a protocol.
 */

/** What a connector is for. A tag the person and the agent read, not a code path. */
export type TConnectorKind = 'mail' | 'calendar' | 'files' | 'chat' | 'notes' | 'other';

export const CONNECTOR_KINDS: readonly TConnectorKind[] = [
  'mail',
  'calendar',
  'files',
  'chat',
  'notes',
  'other',
];

/** The person's own decision about one tool, over what the service claims about it. */
export type TToolDecision = 'read' | 'write' | 'blocked';

/** What a tool is treated as: reading is allowed, writing is held for the person, blocked is never called. */
export type TToolAccess = TToolDecision;

export interface IConnector {
  /** `connector-` and a slug; unique within one person's connectors. */
  readonly id: string;
  readonly title: string;
  readonly kind: TConnectorKind;
  /** Which protocol adapter reaches it, such as `mcp`. */
  readonly protocol: string;
  /** Where the service is reached: an `https` address that carries no credential. */
  readonly endpoint: string;
  /**
   * What the person registered with the service's authorization server when it has no dynamic
   * registration. Public values only: a secret never lives in a connector.
   */
  readonly oauth?: {
    readonly clientId?: string;
    readonly scopes?: readonly string[];
  };
  /** The person's decisions, by tool name. A tool without one is sorted by what the service claims. */
  readonly decisions: Readonly<Record<string, TToolDecision>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What a service says about a tool's effect: a claim, never a guarantee. */
export interface IConnectorToolHints {
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
  readonly openWorld?: boolean;
}

/** A tool a connected service offers, as the service declared it. */
export interface IConnectorToolInfo {
  readonly name: string;
  readonly description?: string;
  /** The input the tool takes, JSON-Schema-shaped. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly hints?: IConnectorToolHints;
}

/**
 * Where the person stands with a connector, as a fixed word:
 * `not-connected`, `connecting` (the person has to finish signing in), `connected`,
 * `needs-sign-in` (a credential was kept but can no longer be used) or `failed`.
 */
export type TConnectorState =
  'not-connected' | 'connecting' | 'connected' | 'needs-sign-in' | 'failed';

export interface IConnectorStatus {
  readonly state: TConnectorState;
  /** Why a sign-in or a connection failed, as a fixed word; never text from a service or a token. */
  readonly reason?: string;
  /** While connecting: where the person's browser goes to consent. */
  readonly authorizationUrl?: string;
  /** While connecting: the address the consent returns to, which a pre-registered client must list. */
  readonly redirectUri?: string;
  /**
   * While connected: the scopes the service says it granted, as scope words. What the person
   * consented to is this, so it is shown as the authoritative permission; never a token or derived
   * from one.
   */
  readonly scope?: string;
}

/** Where the person's browser reaches this agent; the consent returns there. */
export interface ISignInContext {
  readonly origin: string;
}

export type TRevocation = 'revoked' | 'partial' | 'unsupported' | 'failed' | 'not-attempted';

export interface IDisconnectOutcome {
  /** Whether a credential was kept before. It is gone now whatever the service answered. */
  readonly removed: boolean;
  readonly revocation: TRevocation;
}

export interface IConnectorCallResult {
  /** What the service returned, as text. It is data from the service, never instructions. */
  readonly text: string;
  readonly isError: boolean;
}

/**
 * One protocol's way to reach a service. The composition root supplies it, because reaching a
 * service needs a host (network, files, a browser sign-in), and the pack stays neutral.
 */
export interface IConnectorProtocol {
  readonly id: string;
  status(connector: IConnector): Promise<IConnectorStatus>;
  /**
   * Start the person's sign-in. Returns at once with where their browser goes; the sign-in finishes
   * on its own when the browser comes back, and `status` then says `connected` or `failed`.
   */
  signIn(connector: IConnector, context: ISignInContext): Promise<IConnectorStatus>;
  /** Delete the credential first, then ask the service to revoke it. */
  signOut(connector: IConnector): Promise<IDisconnectOutcome>;
  tools(connector: IConnector): Promise<readonly IConnectorToolInfo[]>;
  call(
    connector: IConnector,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<IConnectorCallResult>;
  /** Let go of what is held for a connector that is being removed. */
  forget(connector: IConnector): Promise<void>;
  close(): Promise<void>;
}

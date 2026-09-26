import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type { IPresetApplicationOptions } from './preset/preset-application-types.js';
import type { ICommandSessionModel } from './session-roles.js';
import type { IOutputStylePrompt } from '../context/output-style-prompt.js';
import type { IInteractiveSessionRecord } from '../interactive/session-persistence.js';
import type { IModelEffortResolution, TEffortSelection } from '../effort/effort-resolution.js';
import type { ICommandAdvisorAdapter } from '../advisor/advisor-spec.js';
import type {
  IToolWithEventService,
  TPermissionMode,
  TSessionEndReason,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import type { IPermissionDenial } from '@robota-sdk/agent-session';
import type { TWorkspaceRelation } from '@robota-sdk/agent-interface-session-mobility';

export interface ICommandSettingsDocument {
  [key: string]: TUniversalValue;
}

export interface ICommandSettingsAdapter<
  TSettings extends ICommandSettingsDocument = ICommandSettingsDocument,
> {
  read(): TSettings;
  write(settings: TSettings): void;
  /**
   * CMD-004 Phase 2: delete the settings document (the host-executed `settings-reset` action).
   * Returns `true` when a document existed and was removed. Optional — a composition that does not
   * wire it makes the reset action fail EXPLICITLY in the command result (no-fallback), never a
   * silent skip.
   */
  delete?(): boolean;
}

export interface ICommandProcessAdapter {
  requestExit(reason?: TSessionEndReason): void;
  requestRestart(reason: TSessionEndReason, message: string): void;
}

export interface ICommandPickerAdapter<TItem extends ICommandSettingsDocument> {
  pick(items: readonly TItem[]): Promise<TItem | undefined> | TItem | undefined;
}

export interface ICommandPermissionModeAdapter {
  getPermissionMode(): TPermissionMode;
  setPermissionMode(mode: TPermissionMode): void;
  listSessionAllowedTools(): readonly string[];
  /** The allow/deny/ask rules the gate reads right now. */
  getPermissionRules(): {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly ask: readonly string[];
  };
  /** The calls the session refused, most recent first. */
  listRecentDenials(): readonly IPermissionDenial[];
  /** Let the call behind a classifier denial (0-based) run once; `undefined` when there is none. */
  retryDenial(index: number): IPermissionDenial | undefined;
}

/** The permission rules one settings layer declares, named the way the user would find the file. */
export interface IPermissionRuleLayer {
  /** The file as the user would find it, e.g. `~/.robota/settings.json`. */
  readonly source: string;
  readonly scope: string;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly ask: readonly string[];
}

/** Where each configured permission rule comes from, read fresh on every call. */
export interface ICommandPermissionRulesAdapter {
  readLayers(): readonly IPermissionRuleLayer[];
}

/** How shell commands are confined: not at all, confined without prompts, or confined and asked. */
export type TSandboxCommandMode = 'off' | 'auto-allow' | 'regular';

export interface ICommandSandboxStatus {
  readonly mode: TSandboxCommandMode;
  /** `bubblewrap` or `seatbelt`; absent where the platform has none. */
  readonly backend?: string;
  /** Why confinement cannot run here, when it cannot: what to install, or the platform. */
  readonly unavailable?: string;
  readonly network: boolean;
  readonly excludedCommands: readonly string[];
}

/** The OS sandbox, live: `/sandbox` reads it and changes the mode for the next command. */
export interface ICommandSandboxAdapter {
  status(): ICommandSandboxStatus;
  /** Apply the mode now and save it in the user settings. */
  setMode(mode: TSandboxCommandMode): void;
}

/** Live model-effort state and application seam supplied by the composition root. */
export interface ICommandEffortAdapter {
  getResolution(): IModelEffortResolution;
  apply(
    selection: TEffortSelection,
    session: ICommandSessionModel,
  ): IModelEffortResolution | Promise<IModelEffortResolution>;
}

/**
 * REMOTE-008: view of `/remote-control` state, so the command can report status without touching the
 * transport. CMD-004 Phase 2 supersedes the original status-only design: the enable/stop ACTIONS are
 * now host-executed through this adapter (wired at the composition root) instead of surface-rendered
 * legacy command effects, so they work on every surface (remote/headless included).
 */
export type TRemoteControlStatus =
  | { readonly state: 'off' }
  | { readonly state: 'no-relay' }
  | { readonly state: 'awaiting-pairing'; readonly pairingUrl: string }
  | { readonly state: 'paired' };

/** A trusted device summary for `/remote-control devices` (public data only; REMOTE-012 E3). */
export interface IRemoteTrustedDeviceSummary {
  readonly deviceId: string;
  readonly label: string;
  readonly lastSeenAt: string;
}

export interface ICommandRemoteControlAdapter {
  getStatus(): TRemoteControlStatus;
  /** REMOTE-012 E3: enrolled trusted devices (for `/remote-control devices`). Absent → TOFU not available. */
  listDevices?(): IRemoteTrustedDeviceSummary[];
  /** REMOTE-012 E3: revoke a trusted device by id (for `/remote-control revoke <id>`); returns true if removed. */
  revokeDevice?(deviceId: string): boolean;
  /**
   * Where the host keeps its identity key, in one line for the operator (for `/remote-control
   * status`), or `undefined` while no key has been needed yet. Absent ⇒ the host keeps no key.
   */
  describeKeyStorage?(): string | undefined;
  /**
   * CMD-004 Phase 2: enable remote control (host-executed `remote-control-enable` action). Resolves
   * to the user-facing message (pairing QR/link, or a fail-closed notice) which the host folds into
   * the command result. Absent ⇒ the action fails explicitly in the result (no-fallback).
   */
  enable?(): string | Promise<string>;
  /** CMD-004 Phase 2: stop remote control; resolves to the user-facing message (see {@link enable}). */
  stop?(): string | Promise<string>;
}

/**
 * MCP-2520 — public, secret-free view of one resolved MCP definition. The command layer can show
 * this value and request a decision, but it cannot construct or connect an MCP client.
 */
export interface ICommandMCPActivationSummary {
  readonly serverId: string;
  readonly displayName?: string;
  readonly source: 'managed' | 'user' | 'project' | 'plugin' | 'local';
  readonly status: 'approved' | 'pending' | 'rejected' | 'revoked' | 'stale' | 'untrusted';
  readonly allowed: boolean;
  readonly reason: string;
  readonly provenanceId: string;
  readonly definitionFingerprint: string;
  readonly securityIdentity: string;
}

/**
 * A definition-source-level problem — issue #2794: a configuration root that is not an object, no
 * `mcpServers` key, `mcpServers` not an object, or a source that could not be parsed at all. It
 * names no server, so it cannot be an `ICommandMCPActivationSummary`; this is its own carrier so
 * `/mcp status` can say which source could not be read, beside the servers that did resolve.
 *
 * `blockedServerNames` (PR #3076 review): when this problem is in the MANAGED tier, `agent-mcp`'s
 * `resolveByPrecedence` fails closed and blocks every name that would otherwise have resolved from a
 * lower tier — those names would otherwise vanish from `/mcp status` with no explanation, since a
 * blocked entry is `unresolved` and `ICommandMCPActivationAdapter.list()` only ever offers resolved
 * candidates. Optional and empty for a non-managed-tier problem, which blocks nothing.
 */
export interface ICommandMCPSourceProblem {
  readonly source: 'managed' | 'user' | 'project' | 'plugin' | 'local';
  readonly origin: string;
  readonly reason: string;
  readonly blockedServerNames?: readonly string[];
}

/**
 * One OAuth server's sign-in state as `/mcp` may show it: a fixed word, never a token, scope, expiry
 * time or anything else derived from a credential.
 */
export interface ICommandMCPOAuthStatus {
  readonly serverId: string;
  readonly state: 'signed-in' | 'expired-refreshable' | 'sign-in-required' | 'signed-out';
}

/** What signing out did, by fixed reasons only. */
export interface ICommandMCPOAuthLogoutResult {
  readonly serverId: string;
  /** Whether a credential was stored before the sign-out. */
  readonly removed: boolean;
  readonly revocation: 'revoked' | 'partial' | 'unsupported' | 'failed' | 'not-attempted';
  /** The first step that refused, when a revocation was not confirmed. */
  readonly revocationFailure?: string;
  /** Each token a revocation was asked for, by kind — never its value. */
  readonly tokens?: readonly {
    readonly token: 'refresh_token' | 'access_token';
    readonly revoked: boolean;
    readonly failure?: string;
  }[];
}

/** Where the user signs in, shown when they paste the redirect back rather than a listener receiving it. */
export interface ICommandMCPOAuthRedirectPrompt {
  readonly authorizationUrl: string;
  /** Where the browser is sent after approval; that page may not load. */
  readonly redirectUri: string;
}

/** One in-session sign-in, as the command asks for it. */
export interface ICommandMCPOAuthLoginRequest {
  readonly serverId: string;
  /** Open no browser: the user opens the authorization URL and pastes the redirect back. */
  readonly noBrowser: boolean;
  /**
   * Asks the user, through the session's own prompt, for the redirect URL their browser was sent
   * to — with `noBrowser`, or when no browser could be opened. Absent: no one can be asked, and a
   * sign-in that needs a paste is refused before it starts or fails as `browser-failed`.
   */
  readonly readRedirect?: (
    prompt: ICommandMCPOAuthRedirectPrompt,
    signal: AbortSignal,
  ) => Promise<string>;
  /**
   * Without `noBrowser`: shows the user the authorization URL before the browser is opened, so a
   * browser that opens silently or not at all never leaves them waiting on nothing. `paste` switches
   * to reading the pasted redirect; `cancel` ends the sign-in. Absent: the browser opens directly.
   */
  readonly confirmBrowser?: (
    prompt: ICommandMCPOAuthRedirectPrompt,
    signal: AbortSignal,
  ) => Promise<'open' | 'paste' | 'cancel'>;
  /** Cancels the sign-in; it then fails as `cancelled` and changes nothing. */
  readonly signal?: AbortSignal;
}

/**
 * What an in-session sign-in did, by fixed words and reasons only — never a code, token or
 * authorization-server text.
 */
export interface ICommandMCPOAuthLoginResult {
  readonly serverId: string;
  /** Present when the sign-in did not complete; the session was then left unchanged. */
  readonly failure?: string;
  /** Whether the definition names a pre-registered client, which may need a client secret. */
  readonly preRegisteredClient: boolean;
  /**
   * After a sign-in, the server in this session: `connected` with the tools it now offers,
   * `recovered` when its tools were already offered and its connection works again,
   * `not-admitted` when admission refused it, `not-connected` when it still could not connect.
   */
  readonly connection?: 'connected' | 'recovered' | 'not-admitted' | 'not-connected';
  /** The tools a newly connected server offers, for the session to add. */
  readonly tools: readonly IToolWithEventService[];
}

/** MCP activation lifecycle port. Implemented by the composition root over the MCP policy service. */
export interface ICommandMCPActivationAdapter {
  list(): readonly ICommandMCPActivationSummary[];
  /**
   * Where the user acts on a command the model suggests: `session` when they can type a `/mcp`
   * command, `terminal` for a run with no such prompt (sign-in is then the terminal command).
   * Absent → `session`.
   */
  readonly userActionSurface?: 'session' | 'terminal';
  /**
   * Every source-level problem from the most recent resolution (issue #2794). Optional so an older
   * or narrower adapter implementation still satisfies this interface; a caller that wants to render
   * source problems treats a missing method the same as an empty list.
   */
  sourceProblems?(): readonly ICommandMCPSourceProblem[];
  approve(serverId: string): ICommandMCPActivationSummary | Promise<ICommandMCPActivationSummary>;
  reject(serverId: string): ICommandMCPActivationSummary | Promise<ICommandMCPActivationSummary>;
  revoke(serverId: string): ICommandMCPActivationSummary | Promise<ICommandMCPActivationSummary>;
  /** Sign-in state of every server that declares OAuth. Absent: the host offers no OAuth. */
  oauthStatus?(): Promise<readonly ICommandMCPOAuthStatus[]>;
  /** Sign out of one OAuth server. Rejects for a server that does not declare OAuth. */
  oauthLogout?(serverId: string): Promise<ICommandMCPOAuthLogoutResult>;
  /**
   * Sign in to one OAuth server, then connect it in this session through the normal admission.
   * Never rejects for a failed sign-in: it names the failure. Absent: the host offers no in-session
   * sign-in.
   */
  oauthLogin?(request: ICommandMCPOAuthLoginRequest): Promise<ICommandMCPOAuthLoginResult>;
  /**
   * Which of the tools `oauthLogin` returned the session actually took; any other was left out for
   * a name it already had. Called once per sign-in that returned tools.
   */
  oauthToolsAdded?(serverId: string, added: readonly string[]): void;
}

/**
 * PEER-004 (#1863): a live session this one can address, as the operator sees it.
 *
 * Display data only. `sessionId` names the peer for a later `send`; `liveness` is carried rather
 * than filtered so the operator can tell "I could not determine" from "not running" — a host with no
 * way to read process start times answers `unknown`, and collapsing that into either verdict would
 * be the guess the registry refuses to make.
 */
export interface ILocalPeerSummary {
  readonly sessionId: string;
  readonly name?: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  /** Content-free observed activity; unknown when stale or unverified. */
  readonly status?: 'working' | 'needs-input' | 'idle' | 'unknown';
  /** How the peer's workspace relates to this one's, judged from what this session read at the claimed path. */
  readonly workspaceRelation?: TWorkspaceRelation;
  /** `mismatched` when the peer's claim disagreed with what this session read; it is not believed. */
  readonly workspaceClaim?: 'verified' | 'mismatched' | 'absent';
}

/**
 * Another of the user's devices with an admitted device-mesh link to this session, as the operator
 * sees it. `deviceId` names it for a later `send`; `locality` is where the carrier established it
 * runs, shown and never an authority input.
 */
export interface ILinkedDeviceSummary {
  readonly deviceId: string;
  readonly name?: string;
  readonly locality: 'same-host' | 'another-host';
}

/**
 * PEER-004: what `/peers` reads. The registry, the guarded directory and the liveness rule all live
 * in the composition root — a command never touches the filesystem, for the same reason it never
 * constructs a transport.
 */
export interface ICommandLocalPeersAdapter {
  /** Every announced session, this one included. Ordering is the adapter's. */
  list(): readonly ILocalPeerSummary[];
  /**
   * The same rows with each other peer's workspace relation filled in. Separate and asynchronous
   * because judging a relation reads git; `list` stays cheap for callers that only need liveness.
   */
  listWithWorkspace?(): Promise<readonly ILocalPeerSummary[]>;
  /** This session's own id, so the command can mark which row is the reader. */
  ownSessionId(): string;
  /**
   * The user's other devices linked to this session over the device mesh, addressed by device id
   * wherever a session id is taken. Absent on a host with no device mesh.
   */
  listDevices?(): readonly ILinkedDeviceSummary[];
  /**
   * PEER-006: hand `text` to another announced session, and report what came back.
   *
   * Returns a delivery state rather than throwing, because "the peer refused it" and "the carrier
   * broke" are both answers the operator needs, and an exception would flatten them into one.
   * Absent on a host that can discover peers but cannot address them.
   *
   * `inReplyTo` names the received message this answers, which threads a conversation; the host
   * refuses a reply that would run a conversation past its limits, and tells the operator.
   */
  send?(
    targetSessionId: string,
    text: string,
    options?: { readonly inReplyTo?: string },
  ): Promise<ILocalPeerSendResult>;
  /**
   * Resolve and check a file for sending to another announced session, before anyone is asked about
   * it. `origin` says who asks: the operator's command may send any regular file they can read, the
   * model only a workspace file that does not look like it holds secrets. Absent on a host that
   * cannot send files.
   */
  prepareFile?(
    targetSessionId: string,
    path: string,
    options: { readonly origin: 'operator' | 'model'; readonly cwd: string },
  ): Promise<TLocalPeerFilePreparation>;
}

/** A file checked and measured for sending, or why it cannot be sent. */
export type TLocalPeerFilePreparation =
  | {
      readonly ok: true;
      readonly file: {
        readonly path: string;
        readonly size: number;
        readonly sha256: string;
        /** Copy the content to the session it was prepared for. */
        send(): Promise<ILocalPeerSendResult>;
      };
    }
  | { readonly ok: false; readonly reason: string };

/**
 * PEER-006: what the sender learns, in the vocabulary the operator reads.
 *
 * Deliberately not the transport's ack type: the command layer must not import the wire contract to
 * print a sentence, and `pending` — the honest answer while a message waits behind a running turn —
 * is a state the operator has to be able to see named.
 */
export interface ILocalPeerSendResult {
  readonly state: 'pending' | 'delivered' | 'acknowledged' | 'duplicate' | 'refused' | 'failed';
  readonly reason?: string;
}

/**
 * ARCH-009 — the discovery half of a preset registry, named HERE rather than imported.
 *
 * `agent-preset` depends on `agent-framework`, not the other way round, so importing its
 * `IPresetRegistry` would invert the layering to describe a value this package only hands to a
 * command. Structural typing means the registry `agent-preset` builds satisfies this without either
 * package naming the other.
 *
 * Only the three members `/preset` actually calls are named. A port that mirrors a whole contract it
 * does not use is a second copy of that contract waiting to drift.
 *
 * It is an ADAPTER and not a host-role member, because that is what it is: a capability the
 * composition root supplies, reached the way `/permission-mode` and `/plugin` already reach theirs.
 * Absent ⇒ the host loaded no external presets, and `/preset` lists the built-ins.
 */
export interface ICommandPresetRegistryAdapter {
  /**
   * `title` and `description` are REQUIRED, because `/preset list` renders both. Optional members
   * here would let a conforming host typecheck and then print `id — undefined: undefined`; review of
   * ARCH-009 reported exactly that. A port requires what its consumer needs, and variation belongs in
   * the VALUE, not in whether the member exists.
   */
  listPresets(): readonly { id: string; title: string; description: string }[];
  /** PRESENCE only — `/preset` asks whether the id is known, never what it holds. */
  getPreset(id: string): unknown;
  /**
   * The re-appliable option subset. `IPresetApplicationOptions` is framework-owned and
   * `agent-preset`'s `IResolvedPresetOptions` satisfies it structurally, so naming it here crosses no
   * layer and leaves nothing for a consumer to assert about a value it did not check.
   */
  resolvePreset(id: string, context?: unknown): IPresetApplicationOptions;
}

/** CLI-1988: the command-facing projection of the host's provider-neutral output-style registry. */
export interface ICommandOutputStyleSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tokenCost?: string;
  readonly source?: string;
}

/** CLI-1988: discovery and resolution only; commands never read style files or own persistence. */
export interface ICommandOutputStyleRegistryAdapter {
  listOutputStyles(): readonly ICommandOutputStyleSummary[];
  getOutputStyle(id: string): IOutputStylePrompt | undefined;
}

/**
 * HANDOFF-001 (issue #1864): what a hand-off looks like to the operator, in the operator's words.
 *
 * Deliberately not the wire package's `THandoffPhase`. The command layer must not import the wire
 * contract to print a sentence, and the two vocabularies answer different questions — `staged` is a
 * protocol state, while "the other machine has it and is not running it yet" is what the person
 * standing at the keyboard needs to be told.
 */
export interface IHandoffProgress {
  readonly state: 'offered' | 'sending' | 'awaiting-confirmation' | 'done' | 'stopped';
  /** Present when the transfer stopped without completing. Named so the operator can act on it. */
  readonly reason?: string;
  /** Is THIS machine still in charge of the session? The single question the whole design answers. */
  readonly stillMine: boolean;
}

/** What stays behind, surfaced BEFORE the operator confirms, because it is their choice to lose it. */
export interface IHandoffStaysBehind {
  readonly uncommittedChanges: boolean;
  readonly subprocesses: number;
}

/** A `/cd` the session has already checked and prepared; the host carries it out. */
export interface IWorkspaceMoveRequest {
  /** The directory the session runs in now. */
  readonly fromCwd: string;
  /** The canonical absolute directory to move to. */
  readonly targetCwd: string;
  /** The conversation, copied for the target — its `cwd` is already `targetCwd`. */
  readonly record: IInteractiveSessionRecord;
  /**
   * The session is Restricted. A move never widens access, so the target stays Restricted whatever
   * its own trust decision; a trusted session takes the target's own decision.
   */
  readonly restricted: boolean;
}

/**
 * What `/cd` hands the host. A move is a NEW session in the target directory, composed the way the
 * host composes any session there — its settings, trust decision, tools and instructions — resuming
 * this conversation. Absent on a host that cannot start one; `/cd` then says so.
 */
export interface ICommandWorkspaceAdapter {
  move(request: IWorkspaceMoveRequest): Promise<void>;
}

/**
 * What `/handoff` reads. The carrier, the wire composition and the device identity all live in the
 * composition root — a command never constructs a transport.
 */
export interface ICommandHandoffAdapter {
  /** The machines this session could be moved to. Empty is an answer, not an error. */
  destinations(): Promise<readonly { readonly deviceId: string; readonly name?: string }[]>;
  /**
   * What will not travel, so the operator is asked with the facts in front of them.
   *
   * Read before the confirmation prompt rather than after: uncommitted work and running
   * subprocesses stay on this machine by design, and a consent that did not mention them is not
   * consent to lose them.
   */
  staysBehind(): Promise<IHandoffStaysBehind>;
  /**
   * Move this session to `deviceId`, reporting progress as it goes.
   *
   * Returns the final progress rather than throwing: "the destination cannot run it" and "the link
   * broke" are both answers the operator needs, and an exception would flatten them into one. In
   * every non-`done` outcome `stillMine` is true — that is the invariant the command prints.
   */
  transfer(
    deviceId: string,
    onProgress?: (progress: IHandoffProgress) => void,
  ): Promise<IHandoffProgress>;
  /** Is this machine still authoritative? Asked without starting anything. */
  status(): IHandoffProgress;
}

/** The persisted `/cost budget` document. */
export interface ICommandCostBudget {
  monthly: number;
}

/**
 * CMD-007 (issue #2058): the narrow storage port `/cost budget` reads and writes through.
 *
 * The command used to own the budget file's location and the filesystem calls itself, which made a
 * reusable command package responsible for a product's storage location and symlink policy. The
 * shell now composes an adapter (agent-cli: a file under the workspace, written atomically and never
 * through a symlink); the command sees `read/write/clear` and nothing else, so another product can
 * store the budget wherever it likes. `write`/`clear` throw a typed failure the command renders.
 */
export interface ICommandCostBudgetAdapter {
  /** `undefined` when no budget is set (absent, empty or unreadable document alike). */
  read(): ICommandCostBudget | undefined;
  write(budget: ICommandCostBudget): void;
  clear(): void;
}

export interface ICommandHostAdapters {
  settings?: ICommandSettingsAdapter;
  effort?: ICommandEffortAdapter;
  /** The live advisor: `/advisor` changes its target without touching the session's tools. */
  advisor?: ICommandAdvisorAdapter;
  /** CMD-007 (issue #2058). Absent on a host with no budget storage — `/cost budget` then says so. */
  costBudget?: ICommandCostBudgetAdapter;
  process?: ICommandProcessAdapter;
  permissionMode?: ICommandPermissionModeAdapter;
  /** Absent on a host that cannot name its settings layers — `/permissions` then lists rules unattributed. */
  permissionRules?: ICommandPermissionRulesAdapter;
  plugin?: ICommandPluginAdapter;
  remoteControl?: ICommandRemoteControlAdapter;
  mcpActivation?: ICommandMCPActivationAdapter;
  localPeers?: ICommandLocalPeersAdapter;
  /**
   * ARCH-009 — the instance registry the host resolved with, so in-session `/preset` discovers THIS
   * product's presets. Its absence is why `agent-preset` had to keep a module-global registry: a
   * command runs with an `ICommandHostContext` and nothing else, so this bag is the path from the
   * shell to the command.
   */
  presetRegistry?: ICommandPresetRegistryAdapter;
  /** CLI-1988 — the instance-scoped output-style catalog resolved by the composition root. */
  outputStyleRegistry?: ICommandOutputStyleRegistryAdapter;
  /**
   * HANDOFF-001 (issue #1864). Absent on a host with no carrier — `/handoff` then says so rather
   * than offering a transfer it cannot perform.
   */
  handoff?: ICommandHandoffAdapter;
  /** Absent on a host that cannot start a session elsewhere — `/cd` then says so. */
  workspace?: ICommandWorkspaceAdapter;
  /** Absent on a host with no OS sandbox — `/sandbox` then says so. */
  sandbox?: ICommandSandboxAdapter;
}

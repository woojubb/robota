/**
 * The connector registry: the person's connectors, each reached through its protocol's adapter, with
 * every tool sorted into reading, writing or blocked in one place.
 *
 * A tool is read only when the person said so or the service declared it read-only. A declaration is
 * the service's claim, so a tool that declares nothing is a write: reading is allowed on its own,
 * writing is held for the person, and the registry refuses to run a write through the reading path.
 */
import { ConnectorRefusedError } from './book.js';

import type { ConnectorBook } from './book.js';
import type {
  IConnector,
  IConnectorCallResult,
  IConnectorProtocol,
  IConnectorStatus,
  IConnectorToolInfo,
  IDisconnectOutcome,
  ISignInContext,
  TToolAccess,
  TToolDecision,
} from './types.js';

export interface IConnectorToolView extends IConnectorToolInfo {
  /** What the tool is treated as. */
  readonly access: TToolAccess;
  /** The person's own decision, when there is one. */
  readonly decision?: TToolDecision;
}

export interface IConnectorView {
  readonly connector: IConnector;
  readonly status: IConnectorStatus;
  /** The tools a connected service offers; absent while it is not connected or cannot be reached. */
  readonly tools?: readonly IConnectorToolView[];
}

export interface IConnectorRegistryOptions {
  readonly book: ConnectorBook;
  readonly protocols: readonly IConnectorProtocol[];
  /** How long a service's tool list is reused; a new decision or a miss refreshes it sooner. */
  readonly toolCacheMs?: number;
  readonly now?: () => number;
}

const DEFAULT_TOOL_CACHE_MS = 5 * 60_000;

/** What a tool is treated as: the person's decision first, else the service's read-only claim, else a write. */
export function classifyTool(connector: IConnector, tool: IConnectorToolInfo): TToolAccess {
  const decision = Object.hasOwn(connector.decisions, tool.name)
    ? connector.decisions[tool.name]
    : undefined;
  if (decision !== undefined) return decision;
  return tool.hints?.readOnly === true ? 'read' : 'write';
}

export class ConnectorRegistry {
  private readonly book: ConnectorBook;
  private readonly protocols: ReadonlyMap<string, IConnectorProtocol>;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { at: number; tools: readonly IConnectorToolInfo[] }>();

  constructor(options: IConnectorRegistryOptions) {
    this.book = options.book;
    this.protocols = new Map(options.protocols.map((protocol) => [protocol.id, protocol]));
    this.cacheMs = options.toolCacheMs ?? DEFAULT_TOOL_CACHE_MS;
    this.now = options.now ?? Date.now;
  }

  private protocolOf(connector: IConnector): IConnectorProtocol {
    const protocol = this.protocols.get(connector.protocol);
    if (protocol === undefined) {
      throw new ConnectorRefusedError(`This agent has no "${connector.protocol}" adapter`);
    }
    return protocol;
  }

  private async toolsOf(
    connector: IConnector,
    refresh = false,
  ): Promise<readonly IConnectorToolInfo[]> {
    const cached = this.cache.get(connector.id);
    if (!refresh && cached !== undefined && this.now() - cached.at < this.cacheMs) {
      return cached.tools;
    }
    const tools = await this.protocolOf(connector).tools(connector);
    this.cache.set(connector.id, { at: this.now(), tools });
    return tools;
  }

  private viewTools(
    connector: IConnector,
    tools: readonly IConnectorToolInfo[],
  ): IConnectorToolView[] {
    return tools.map((tool) => ({
      ...tool,
      access: classifyTool(connector, tool),
      ...(Object.hasOwn(connector.decisions, tool.name) && {
        decision: connector.decisions[tool.name],
      }),
    }));
  }

  async view(id: string, options: { readonly refresh?: boolean } = {}): Promise<IConnectorView> {
    const connector = await this.book.existing(id);
    const status = await this.protocolOf(connector).status(connector);
    if (status.state !== 'connected') return { connector, status };
    try {
      const tools = await this.toolsOf(connector, options.refresh === true);
      return { connector, status, tools: this.viewTools(connector, tools) };
    } catch {
      // allow-fallback: a service that cannot be reached right now is shown as failed, not as an error page.
      return { connector, status: { state: 'failed', reason: 'unreachable' } };
    }
  }

  async list(): Promise<readonly IConnectorView[]> {
    const connectors = await this.book.list();
    return Promise.all(connectors.map((connector) => this.view(connector.id)));
  }

  /** Start the person's sign-in; the answer says where their browser goes. */
  async signIn(id: string, context: ISignInContext): Promise<IConnectorStatus> {
    const connector = await this.book.existing(id);
    this.cache.delete(id);
    return this.protocolOf(connector).signIn(connector, context);
  }

  async disconnect(id: string): Promise<IDisconnectOutcome> {
    const connector = await this.book.existing(id);
    this.cache.delete(id);
    return this.protocolOf(connector).signOut(connector);
  }

  /** Disconnect and forget a connector: the credential is deleted before anything else. */
  async remove(id: string): Promise<IDisconnectOutcome> {
    const connector = await this.book.existing(id);
    const outcome = await this.disconnect(id);
    await this.protocolOf(connector).forget(connector);
    await this.book.remove(id);
    return outcome;
  }

  async decide(id: string, tool: string, decision: TToolDecision | undefined): Promise<IConnector> {
    const connector = await this.book.decide(id, tool, decision);
    this.cache.delete(id);
    return connector;
  }

  /** One connector's tools as the model should see them. */
  async describe(id: string): Promise<IConnectorView> {
    const view = await this.view(id);
    if (view.tools === undefined) {
      throw new ConnectorRefusedError(this.notReady(view.connector, view.status));
    }
    return view;
  }

  private notReady(connector: IConnector, status: IConnectorStatus): string {
    return status.state === 'connected'
      ? `${connector.title} cannot be reached right now`
      : `${connector.title} is not connected (${status.state}); the person connects it from the Connectors tab`;
  }

  private async resolve(
    id: string,
    tool: string,
  ): Promise<{ connector: IConnector; protocol: IConnectorProtocol; access: TToolAccess }> {
    const connector = await this.book.existing(id);
    const protocol = this.protocolOf(connector);
    const status = await protocol.status(connector);
    if (status.state !== 'connected')
      throw new ConnectorRefusedError(this.notReady(connector, status));
    let info = (await this.toolsOf(connector)).find((candidate) => candidate.name === tool);
    // A tool the cached list lacks may be new: look once more before refusing.
    info ??= (await this.toolsOf(connector, true)).find((candidate) => candidate.name === tool);
    if (info === undefined) {
      throw new ConnectorRefusedError(`${connector.title} has no tool named ${tool}`);
    }
    return { connector, protocol, access: classifyTool(connector, info) };
  }

  /** Call a tool that only reads. A tool that writes is refused here, whatever the caller says it is. */
  async read(
    id: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<IConnectorCallResult> {
    const { connector, protocol, access } = await this.resolve(id, tool);
    if (access === 'blocked') throw new ConnectorRefusedError(`${tool} is blocked by the person`);
    if (access === 'write') {
      throw new ConnectorRefusedError(
        `${tool} changes or sends something, so it goes through ConnectorAct, which the person approves`,
      );
    }
    return protocol.call(connector, tool, args, signal === undefined ? {} : { signal });
  }

  /** Call a tool that writes or sends. The person's approval is the caller's gate; a read tool is refused. */
  async act(
    id: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<IConnectorCallResult> {
    const { connector, protocol, access } = await this.resolve(id, tool);
    if (access === 'blocked') throw new ConnectorRefusedError(`${tool} is blocked by the person`);
    if (access === 'read') {
      throw new ConnectorRefusedError(`${tool} only reads, so it goes through ConnectorRead`);
    }
    return protocol.call(connector, tool, args, signal === undefined ? {} : { signal });
  }

  async close(): Promise<void> {
    await Promise.all([...this.protocols.values()].map((protocol) => protocol.close()));
  }
}

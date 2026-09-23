/**
 * Shared, non-test helpers for the supervisor test suite (MCP-002 supervisor half).
 *
 * Not itself a `.test.ts` file, so vitest never collects it as a suite; it exists purely so
 * `connection-supervisor.test.ts`, `canonical-failed-state.test.ts`, `failure-classification.test.ts`,
 * `reconnect-backoff.test.ts`, `last-known-good.test.ts`, `timeout-semantics.test.ts`,
 * `shutdown-no-live-requests.test.ts` and `catalog-cache-identity.test.ts` don't each hand-roll a fake
 * `IMCPSession` and a fake `IMCPSupervisorClock`.
 */

import type {
  IMCPDiscovery,
  IMCPDiscoveryDomainResult,
  IMCPServerIdentity,
  TMCPCapabilityDomain,
} from '../catalog/types.js';
import type {
  IMCPDiscoverOptions,
  IMCPSession,
  IMCPToolCallResult,
  TMCPListChangedListener,
} from '../client/session.js';
import type {
  IMCPSupervisorClock,
  IMCPTimeouts,
  TMCPTimerHandle,
} from '../supervisor/connection.js';
import type { TToolParameters } from '@robota-sdk/agent-core';

export function fixtureIdentity(overrides: Partial<IMCPServerIdentity> = {}): IMCPServerIdentity {
  return {
    serverId: 'server-1',
    serverName: 'Test Server',
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
    ...overrides,
  };
}

function emptyDomainResult<TItem>(): IMCPDiscoveryDomainResult<TItem> {
  return { state: { kind: 'unsupported' }, items: [], pages: 0 };
}

export function fixtureDiscovery(
  identity: IMCPServerIdentity,
  overrides: Partial<IMCPDiscovery> = {},
): IMCPDiscovery {
  return {
    identity,
    tools: emptyDomainResult(),
    prompts: emptyDomainResult(),
    resources: emptyDomainResult(),
    ...overrides,
  };
}

export function fixtureTimeouts(overrides: Partial<IMCPTimeouts> = {}): IMCPTimeouts {
  return {
    startupMs: 5_000,
    perCallMs: 5_000,
    globalDefaultMs: 5_000,
    idleMs: 60_000,
    toolCallMs: 5_000,
    ...overrides,
  };
}

export interface IFakeSessionConfig {
  readonly identity: IMCPServerIdentity;
  readonly instructions?: string;
  readonly declaredCapabilities?: IMCPSession['declaredCapabilities'];
  discover?(options: IMCPDiscoverOptions): Promise<IMCPDiscovery>;
  callTool?(
    name: string,
    args: TToolParameters,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<IMCPToolCallResult>;
  close?(): Promise<void>;
}

/** A hand-written fake `IMCPSession`, injected via `options.openSession` — never the real SDK. */
export class FakeMcpSession implements IMCPSession {
  readonly identity: IMCPServerIdentity;
  readonly instructions?: string;
  readonly declaredCapabilities: IMCPSession['declaredCapabilities'];
  readonly externalEventsDeclared = false;

  readonly discoverCalls: IMCPDiscoverOptions[] = [];
  readonly callToolCalls: {
    name: string;
    args: TToolParameters;
    timeoutMs?: number;
  }[] = [];
  closeCalls = 0;

  private readonly listeners = new Set<TMCPListChangedListener>();

  constructor(private readonly config: IFakeSessionConfig) {
    this.identity = config.identity;
    this.instructions = config.instructions;
    this.declaredCapabilities =
      config.declaredCapabilities ??
      ({
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
      } as IMCPSession['declaredCapabilities']);
  }

  async discover(options: IMCPDiscoverOptions): Promise<IMCPDiscovery> {
    this.discoverCalls.push(options);
    if (this.config.discover) {
      return this.config.discover(options);
    }
    return fixtureDiscovery(this.identity);
  }

  async callTool(
    name: string,
    args: TToolParameters,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<IMCPToolCallResult> {
    this.callToolCalls.push({ name, args, timeoutMs: options?.timeoutMs });
    if (this.config.callTool) {
      return this.config.callTool(name, args, options);
    }
    return { content: [], isError: false };
  }

  onListChanged(listener: TMCPListChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExternalEvent(_listener: Parameters<IMCPSession['onExternalEvent']>[0]): () => void {
    return () => undefined;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.config.close) {
      await this.config.close();
    }
  }

  /** Test-only: simulate the server announcing `notifications/<domain>/list_changed`. */
  fireListChanged(domain: TMCPCapabilityDomain): void {
    for (const listener of this.listeners) {
      listener(domain);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

interface IFakeTimer {
  readonly id: number;
  dueAt: number;
  readonly ms: number;
  readonly callback: () => void;
}

/**
 * A hand-rolled `IMCPSupervisorClock` (preferred over `vi.useFakeTimers()` per the task brief) so
 * pending-timer counts are directly inspectable — the instrument TC-17 requires instead of
 * `getActiveResourcesInfo`.
 */
export class FakeSupervisorClock implements IMCPSupervisorClock {
  private currentTime = 0;
  private nextId = 1;
  private readonly timers = new Map<number, IFakeTimer>();
  readonly scheduledDelaysMs: number[] = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, ms: number): TMCPTimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { id, dueAt: this.currentTime + ms, ms, callback });
    this.scheduledDelaysMs.push(ms);
    return id;
  }

  clearTimeout(handle: TMCPTimerHandle): void {
    this.timers.delete(handle as number);
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  /** Advances logical time and fires every timer now due, in due-order, flushing microtasks between. */
  async advance(ms: number): Promise<void> {
    this.currentTime += ms;
    for (;;) {
      const ready = [...this.timers.values()]
        .filter((timer) => timer.dueAt <= this.currentTime)
        .sort((a, b) => a.dueAt - b.dueAt);
      const next = ready[0];
      if (!next) {
        break;
      }
      this.timers.delete(next.id);
      next.callback();
      await flushMicrotasks();
    }
  }
}

/** Lets already-queued promise continuations (e.g. an async catch handler) run before assertions. */
export async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

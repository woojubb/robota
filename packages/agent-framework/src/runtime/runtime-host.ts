/**
 * RUNTIME-001 (Design C) — the shared, presentation-free runtime host.
 *
 * `buildRuntimeSession` is the single session-construction seam: every presentation — the TUI channel, the
 * print channel, and the headless `robota --serve` entry — builds its `InteractiveSession` here from a normalized
 * `SessionRecipe`, instead of each calling the constructor. `startRuntimeHost` adds the
 * transport `startAll/stopAll` lifecycle + a bounded shutdown handle on top; it is used by the headless
 * `--serve` path, which builds and starts atomically. (The TUI channel builds via `buildRuntimeSession` in its
 * constructor and drives `startAll/stopAll` itself in `start()/stop()` — it must wire session events between
 * construction and `startAll`, so it shares only the construction seam, not the host's atomic build+start.)
 *
 * It lives in `agent-framework` (the SDK assembly layer that already owns `InteractiveSession`) — NOT the
 * product shell (`agent-cli`) and NOT a new package: it is presentation/product-neutral (takes already-resolved
 * options; settings/first-run/preset resolution stay in the consumer). Distinct from `createAgentRuntime`, which
 * is the serverless request/response factory over a lossy headless option subset.
 */

import { InteractiveSession } from '../interactive/interactive-session.js';
import { SessionPool } from './session-pool.js';
import { SessionSlot, shutdownSessionBounded } from './session-slot.js';

import type { TInteractiveSessionOptions } from '../interactive/interactive-session.js';
import type {
  ITransportCompletionRecord,
  ITransportFailureRecord,
  ITransportLifecycleRegistryView,
} from '@robota-sdk/agent-interface-transport';

/** Normalized, explicitly discriminated input for every `InteractiveSession` construction path. */
export type SessionRecipe = TInteractiveSessionOptions;

/** Build a runtime `InteractiveSession` from a normalized recipe. The single construction seam. */
export function buildRuntimeSession(recipe: SessionRecipe): InteractiveSession {
  if ('session' in recipe) {
    if (!recipe.session) throw new Error('buildRuntimeSession: injected session is required');
  } else {
    if (!recipe.provider) throw new Error('buildRuntimeSession: provider is required');
    if (!recipe.cwd) throw new Error('buildRuntimeSession: cwd is required');
  }
  return new InteractiveSession(recipe);
}

export interface IRuntimeHostOptions {
  /** The resolved session-build options — the consumer resolves settings/preset/args and passes them in. */
  session: SessionRecipe;
  /** The transport registry (e.g. the loopback WS sidecar); the host owns its start/stop lifecycle. */
  transportRegistry?: ITransportLifecycleRegistryView;
  /** Bind each raw adapter to the host's session slot before registration/start. */
  bindTransports?: (session: SessionSlot) => void;
  /**
   * Keep several sessions live, one per client that switched (#3189). The host's session becomes
   * the pool's primary, and further sessions are built from this recipe. Absent, the host holds one
   * session.
   */
  pool?: IRuntimeHostPoolOptions;
}

export interface IRuntimeHostPoolOptions {
  /** Live sessions at most, the primary included. */
  maxLive?: number;
  /** How long a session no client is on stays live once idle. */
  idleGraceMs?: number;
}

export interface IRuntimeHostHandle {
  /**
   * The live runtime session every presentation drives, behind a slot: whoever holds it reaches the
   * current session, including after the host switches to another one (#3189).
   */
  readonly session: SessionSlot;
  /** The live sessions when started with `pool`; its primary is the one `session` starts on. */
  readonly pool?: SessionPool<InteractiveSession>;
  /** Stop the transports and shut the session down (bounded) — every pooled one; idempotent. */
  shutdown(message?: string): Promise<void>;
  /** Return the complete ordered runner aggregate, including registry-owned abandonment on stop. */
  waitForCompletion(): Promise<ITransportCompletionRecord[]>;
  /** Report only the first real failed runner outcome; normal stop abandonment is not a failure. */
  waitForFailure(): Promise<ITransportFailureRecord | undefined>;
}

/**
 * Build the runtime session and start its transports. Returns a handle the caller renders over (TUI) or simply
 * keeps alive (headless `--serve`). The caller owns the process-lifetime wait; `shutdown()` tears it down.
 */
export async function startRuntimeHost(opts: IRuntimeHostOptions): Promise<IRuntimeHostHandle> {
  const recipe = opts.session;
  if (opts.pool !== undefined && 'session' in recipe) {
    throw new Error(
      'startRuntimeHost: a session pool builds sessions from a recipe, not an injected session',
    );
  }
  const primary = buildRuntimeSession(recipe);
  const session = new SessionSlot(primary);
  const pool =
    opts.pool === undefined
      ? undefined
      : new SessionPool<InteractiveSession>({
          primary,
          build: (resumeSessionId) =>
            buildRuntimeSession({
              ...recipe,
              resumeSessionId,
              // A pooled session is exactly the one asked for; the launch's fork and name do not carry over.
              forkSession: undefined,
              sessionName: undefined,
            }),
          ...opts.pool,
        });
  if (opts.transportRegistry) {
    opts.bindTransports?.(session);
    await opts.transportRegistry.startAll();
  }

  let stopped = false;
  return {
    session,
    ...(pool !== undefined ? { pool } : {}),
    async waitForCompletion(): Promise<ITransportCompletionRecord[]> {
      return (await opts.transportRegistry?.waitForCompletion()) ?? [];
    },
    async waitForFailure(): Promise<ITransportFailureRecord | undefined> {
      return opts.transportRegistry?.waitForFailure();
    },
    async shutdown(message = 'runtime host stopped'): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (opts.transportRegistry) {
        // allow-fallback: best-effort transport teardown — the process is exiting.
        await opts.transportRegistry.stopAll().catch(() => undefined);
      }
      if (pool !== undefined) await pool.shutdownAll(message);
      else await shutdownSessionBounded(session, message);
    },
  };
}

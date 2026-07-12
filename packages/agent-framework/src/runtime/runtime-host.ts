/**
 * RUNTIME-001 (Design C) — the shared, presentation-free runtime host.
 *
 * `buildRuntimeSession` is the single session-construction seam: every presentation — the TUI channel, the
 * print channel, and the headless `robota --serve` entry — builds its `InteractiveSession` here from a resolved
 * `TInteractiveSessionOptions`, instead of each calling `new InteractiveSession`. `startRuntimeHost` adds the
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

import type { IInteractiveSession } from '../interactive/index.js';
import type { TInteractiveSessionOptions } from '../interactive/interactive-session.js';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

/** Upper bound on the graceful session shutdown so a wedged subsystem cannot block process exit. */
const RUNTIME_SHUTDOWN_TIMEOUT_MS = 5000;

/** Build a runtime `InteractiveSession` from fully-resolved options. The single construction seam. */
export function buildRuntimeSession(options: TInteractiveSessionOptions): InteractiveSession {
  return new InteractiveSession(options);
}

export interface IRuntimeHostOptions {
  /** The resolved session-build options — the consumer resolves settings/preset/args and passes them in. */
  session: TInteractiveSessionOptions;
  /** The transport registry (e.g. the loopback WS sidecar); the host owns its start/stop lifecycle. */
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
}

export interface IRuntimeHostHandle {
  /** The live runtime session every presentation drives. */
  readonly session: InteractiveSession;
  /** Stop the transports and shut the session down (bounded); idempotent. */
  shutdown(message?: string): Promise<void>;
}

/**
 * Build the runtime session and start its transports. Returns a handle the caller renders over (TUI) or simply
 * keeps alive (headless `--serve`). The caller owns the process-lifetime wait; `shutdown()` tears it down.
 */
export async function startRuntimeHost(opts: IRuntimeHostOptions): Promise<IRuntimeHostHandle> {
  const session = buildRuntimeSession(opts.session);
  if (opts.transportRegistry) {
    await opts.transportRegistry.startAll(session);
  }

  let stopped = false;
  return {
    session,
    async shutdown(message = 'runtime host stopped'): Promise<void> {
      if (stopped) return;
      stopped = true;
      if (opts.transportRegistry) {
        // allow-fallback: best-effort transport teardown — the process is exiting.
        await opts.transportRegistry.stopAll().catch(() => undefined);
      }
      await Promise.race([
        // allow-fallback: best-effort session shutdown — a wedged subsystem must not block exit.
        session.shutdown({ reason: 'other', message }).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, RUNTIME_SHUTDOWN_TIMEOUT_MS)),
      ]);
    },
  };
}

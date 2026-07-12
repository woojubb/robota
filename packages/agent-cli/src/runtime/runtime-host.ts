/**
 * RUNTIME-001 — the shared, presentation-free runtime host.
 *
 * `startRuntimeHost` builds the `InteractiveSession` and owns the transport `startAll/stopAll` lifecycle. It is
 * the single runtime seam BOTH presentations sit over: the headless `robota --serve` entry runs it directly
 * (no ink), and the interactive TUI renders over the same host handle. This module is deliberately **ink-free**
 * — it imports no presentation package — so the `--serve` process never loads the terminal UI (which is what
 * `apps/agent-app` spawns as its backend; the GUI does NOT control the CLI, it drives this shared runtime).
 */

import { InteractiveSession, type TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

import type {
  IInteractiveSession,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';

/** Upper bound on the graceful session shutdown so a wedged subsystem cannot block process exit. */
const SHUTDOWN_TIMEOUT_MS = 5000;

export interface IRuntimeHostOptions {
  /** The session-build options — the same subset the TUI/print channels construct the session from. */
  session: TInteractiveSessionOptions;
  /** The transport registry (e.g. the loopback WS sidecar); the host owns its start/stop lifecycle. */
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
}

export interface IRuntimeHostHandle {
  /** The live runtime session both presentations drive. */
  readonly session: InteractiveSession;
  /** Stop the transports and shut the session down (bounded); idempotent. */
  shutdown(message?: string): Promise<void>;
}

/**
 * Build the runtime session and start its transports. Returns a handle the caller renders over (TUI) or simply
 * keeps alive (headless `--serve`). The caller owns the process-lifetime wait; `shutdown()` tears the runtime
 * down.
 */
export async function startRuntimeHost(opts: IRuntimeHostOptions): Promise<IRuntimeHostHandle> {
  const session = new InteractiveSession(opts.session);
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
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    },
  };
}

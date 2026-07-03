/**
 * Process survival boundary for the interactive TUI (ERR-001 G1).
 *
 * On Node 20+ an unhandled rejection terminates the process, and the previous
 * `uncaughtException` guard re-threw everything non-IME — any async path outside the turn
 * boundary (background tasks, catalog refresh, persistence) hitting a transient network
 * error could kill the whole TUI. In interactive mode the product installs these
 * last-resort guards: the error is routed into the live session (humanized, styled error
 * block, session log) and the process stays alive. Headless/print mode installs nothing
 * and keeps its fail-fast exit-code contract.
 *
 * This is deliberately product-owned (agent-cli), not library-owned — see the Library
 * Neutrality Rule in .agents/project-structure.md. Each async subsystem should still
 * terminate its own promises; this boundary is the last resort, not the primary handler.
 */

/** The surface the guards need from the live TUI channel. */
export interface IGuardableChannel {
  getSession(): { reportBackgroundError(error: Error, source?: string): void };
}

let liveChannel: IGuardableChannel | null = null;
let guardsInstalled = false;

/** bin.ts consults this so its own uncaughtException fallback keeps fail-fast semantics
 * whenever the TUI guards are NOT active (headless/print mode). */
export function areTuiProcessGuardsActive(): boolean {
  return guardsInstalled;
}

/** Track the current live channel (session switches re-create it). */
export function setLiveChannel(channel: IGuardableChannel): void {
  liveChannel = channel;
}

function routeProcessError(error: Error, source: string): void {
  try {
    if (liveChannel) {
      liveChannel.getSession().reportBackgroundError(error, source);
      return;
    }
  } catch {
    // allow-fallback: this guard IS the last-resort boundary — if rendering into the session itself fails, stderr below is the only remaining surface (ERR-001 G1)
    /* fall through to stderr */
  }
  process.stderr.write(`\n[robota] ${source}: ${error.message}\n`);
}

/**
 * Install the interactive-mode guards. Idempotent. Never masks errors silently — every
 * routed error is visible in the transcript (styled block) and the session log.
 */
export function installTuiProcessGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    routeProcessError(error, 'unhandled rejection');
  });

  // Note: bin.ts installed its IME-aware uncaughtException handler first; it checks
  // areTuiProcessGuardsActive() and defers to this handler instead of re-throwing.
  process.on('uncaughtException', (err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    routeProcessError(error, 'uncaught exception');
  });
}

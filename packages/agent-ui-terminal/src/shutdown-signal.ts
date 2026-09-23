/**
 * Interrupt-signal policy for the interactive TUI (CLI-075 / RUNTIME-33).
 *
 * The first Ctrl+C or termination signal runs the graceful shutdown (persist session, cancel
 * background work, drain queues). A second interrupt arriving while a shutdown is already in flight
 * is a force-quit: the user is telling us the graceful path is wedged, so we exit immediately rather
 * than no-op. Exit code 130 = 128 + SIGINT(2), the conventional "terminated by Ctrl+C" code.
 */

/** Conventional "terminated by SIGINT" exit code (128 + 2). */
export const FORCE_QUIT_EXIT_CODE = 130;

export interface IHandleInterruptParams {
  /** Whether a graceful shutdown is already in progress. */
  isShuttingDown: boolean;
  /** Runs the graceful shutdown (only on the first interrupt). */
  graceful: () => void;
  /** Force-quits the process (defaults to `process.exit`); injectable for tests. */
  forceExit?: (code: number) => void;
}

/**
 * Route an interrupt (Ctrl+C / SIGINT / SIGTERM) to either the graceful path or a force-quit.
 * Keeping this pure and side-effect-injectable makes the second-signal contract unit-testable
 * without spawning a process.
 */
export function handleInterrupt(params: IHandleInterruptParams): void {
  const forceExit = params.forceExit ?? ((code: number): void => process.exit(code));
  if (params.isShuttingDown) {
    forceExit(FORCE_QUIT_EXIT_CODE);
    return;
  }
  params.graceful();
}

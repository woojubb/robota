/**
 * TERM-002: React glue for the terminal-handoff controller.
 *
 * Registers the App's suspend/resume into the controller. On suspend the App renders nothing (see
 * App.tsx) so Ink unmounts its input hooks and releases raw mode, handing the real terminal to the
 * child process; on resume the App re-renders.
 */
import { useEffect, useState } from 'react';

import type { TerminalHandoffController } from '../terminal-handoff-controller.js';

/** Time for React/Ink to commit the empty render (unmount input, release raw mode) before handoff. */
const SUSPEND_COMMIT_DELAY_MS = 50;

export function useTerminalHandoffSuspension(
  controller: TerminalHandoffController | undefined,
): boolean {
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    if (!controller) return;
    return controller.registerSuspendHooks({
      suspend: async () => {
        setSuspended(true);
        await new Promise<void>((resolve) => setTimeout(resolve, SUSPEND_COMMIT_DELAY_MS));
      },
      resume: () => setSuspended(false),
    });
  }, [controller]);
  return suspended;
}

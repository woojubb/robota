/**
 * Test side of the events a PTY fixture records for it (the fixture side is `fixture-event-log.ts`).
 *
 * A test cannot rely on a marker printed to the terminal: a Windows pseudo-console redraws its screen
 * and may never show text that a later frame erased, and a marker lost that way fails a test whose
 * fixture did what it should. A fixture therefore also appends each event as a line to
 * `<result path>.events`, and the test waits on that file. A timeout reports the events recorded so
 * far and the tail of the terminal, which says which step did not happen.
 */
import { existsSync, readFileSync } from 'node:fs';

import { fixtureEventsPath } from './fixture-event-log.js';
import { PTY_TIME_FACTOR } from './spawn-pty.js';

import type { IPtyRunSession } from './spawn-pty.js';

const POLL_MS = 50;
const TERMINAL_TAIL_LENGTH = 2000;

function readFixtureEvents(resultPath: string): string[] {
  const path = fixtureEventsPath(resultPath);
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
}

/** Test side: waits until the fixture has recorded `event`, scaled like every wait of the harness. */
export async function waitForFixtureEvent(
  session: IPtyRunSession,
  resultPath: string,
  event: string,
  timeoutMs = 10_000,
): Promise<void> {
  const scaled = timeoutMs * PTY_TIME_FACTOR;
  const deadline = Date.now() + scaled;
  while (Date.now() < deadline) {
    if (readFixtureEvents(resultPath).includes(event)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(
    `Fixture event timeout (${scaled}ms) for ${event}\n--- events ---\n` +
      `${readFixtureEvents(resultPath).join('\n')}\n--- terminal ---\n` +
      session.snapshot().slice(-TERMINAL_TAIL_LENGTH),
  );
}

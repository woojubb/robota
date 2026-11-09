/**
 * Where a PTY fixture records its events, and how it records them. Imports nothing from the PTY
 * harness: a fixture runs in its own process and must not load the harness's native addon.
 */
import { appendFileSync } from 'node:fs';

export function fixtureEventsPath(resultPath: string): string {
  return `${resultPath}.events`;
}

/** Fixture side: records `event`; a fixture with no result path records nothing. */
export function recordFixtureEvent(resultPath: string | undefined, event: string): void {
  if (resultPath) {
    appendFileSync(fixtureEventsPath(resultPath), `${event.replace(/\s+/g, ' ')}\n`, 'utf8');
  }
}

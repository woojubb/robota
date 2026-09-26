/**
 * #3189 — a served runtime binds its transports to a session slot, and the per-session usage report
 * reads the slot's current session: the report follows a switch rather than failing on the slot.
 */

import { SessionSlot } from '@robota-sdk/agent-framework';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it } from 'vitest';

import { reportCurrentSessionUsage } from '../session-usage-reporter.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';

function sessionWithHistory(id: string): ReturnType<typeof createTestInteractiveSession> {
  const history: IHistoryEntry[] = [];
  return Object.assign(
    createTestInteractiveSession({ getSession: () => ({ getSessionId: () => id }) }),
    { getFullHistory: () => history },
  );
}

describe('reportCurrentSessionUsage', () => {
  it("reports the slot's current session", () => {
    const slot = new SessionSlot(sessionWithHistory('s-1'));
    expect(reportCurrentSessionUsage(slot).sessionId).toBe('s-1');
  });
});

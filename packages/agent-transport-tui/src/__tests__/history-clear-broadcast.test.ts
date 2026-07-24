/**
 * CMD-004 Phase 2 Stage E — the TUI transcript follows the broadcast `history_cleared` event.
 *
 * Final carrier (spec decision): `conversation-history-cleared` becomes a BROADCAST session event,
 * so a clear performed by ANY surface (a co-driving remote `/clear`, or any host-side
 * `clearConversationHistory()` call) refreshes every attached transcript — pre-Stage-E the TUI only
 * cleared from its OWN command result's legacy effect, so a remote clear left it stale.
 *
 * Runs the REAL TuiInteractionChannel over a real InteractiveSession (scripted provider) — no
 * command-result path involved: the mutation alone must drive the transcript refresh.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { createScriptedProvider } from '@robota-sdk/agent-transport/testing';
import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

const READY_DEADLINE_MS = 10_000;
const POLL_MS = 25;

async function waitUntil(predicate: () => boolean, deadlineMs = READY_DEADLINE_MS): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  expect(predicate()).toBe(true);
}

describe('CMD-004 Stage E — history_cleared broadcast clears the TUI transcript', () => {
  let channel: TuiInteractionChannel | undefined;

  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
  });

  it('a host-side conversation clear empties the transcript without any command-result path', async () => {
    const scripted = createScriptedProvider([{ text: 'unused in this test' }]);
    channel = new TuiInteractionChannel({
      cwd: process.cwd(),
      provider: scripted.provider,
    });
    await channel.start();
    const session = channel.getSession();
    await waitUntil(() => {
      try {
        session.getContextState();
        return true;
      } catch {
        return false; // allow-fallback: session init is asynchronous; poll until it is ready
      }
    });

    channel.stateManager.addEntry(messageToHistoryEntry(createSystemMessage('stale entry')));
    expect(channel.stateManager.history.length).toBeGreaterThan(0);

    // The HOST mutation (what a co-driving remote /clear ultimately executes) — the broadcast
    // `history_cleared` event is the ONLY carrier that can refresh this surface's transcript.
    session.clearConversationHistory();

    await waitUntil(() => channel!.stateManager.history.length === 0, 3000);
    expect(channel.stateManager.history).toEqual([]);
  });
});

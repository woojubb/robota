/**
 * CMD-004 Phase 2 (TC-10) — red-first `/rename` host-side persistence proof.
 *
 * Pre-Stage-B, `executeRenameCommand` only RETURNS the `session-renamed` effect and the mutation
 * lives in the TUI renderer (`useSideEffects.ts` calls `interactiveSession.setName`), so a session
 * with NO TUI attached renames nothing — these tests were recorded FAILING against that state
 * (evidence in the spec's Evidence Log). Stage B makes the HOST execute the rename inside the
 * `executeCommand` pipeline (direct-on-session action), strips the applied action from the returned
 * result (so the TUI's duplicate application cannot fire — no double rename), and broadcasts
 * `session_renamed` so every attached surface updates its title.
 */

import { describe, expect, it, vi } from 'vitest';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { ISessionRenamedEvent } from '@robota-sdk/agent-interface-transport';
import { createSessionCommandModule } from '../session-command-module.js';

function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_rename_tc10',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

describe('CMD-004 TC-10 — /rename persists host-side without any TUI handler', () => {
  it('mutates the session name via executeCommand alone and broadcasts session_renamed', async () => {
    const session = new InteractiveSession({
      session: createRuntimeSession() as never,
      commandModules: [createSessionCommandModule()],
    });
    const renamedEvents: ISessionRenamedEvent[] = [];
    session.on('session_renamed', (event) => renamedEvents.push(event));

    const result = await session.executeCommand('rename', 'My Renamed Session');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Session renamed to "My Renamed Session".');
    // The HOST executed the mutation — no surface handler involved (the defect this TC pins).
    expect(session.getName()).toBe('My Renamed Session');
    // Broadcast so every attached surface (incl. co-driving ones) updates its title.
    expect(renamedEvents).toEqual([{ name: 'My Renamed Session' }]);
    // The applied host action is CONSUMED from the returned result — no surface can double-apply it.
    expect(result?.hostActions).toBeUndefined();
  });

  it('applies the rename exactly once (single-execution guard)', async () => {
    const session = new InteractiveSession({
      session: createRuntimeSession() as never,
      commandModules: [createSessionCommandModule()],
    });
    const setNameSpy = vi.spyOn(session, 'setName');

    await session.executeCommand('rename', 'once');

    expect(setNameSpy).toHaveBeenCalledTimes(1);
    expect(setNameSpy).toHaveBeenCalledWith('once');
  });
});

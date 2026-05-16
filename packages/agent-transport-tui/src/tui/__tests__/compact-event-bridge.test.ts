import { describe, expect, it } from 'vitest';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { TuiStateManager } from '../tui-state-manager.js';
import { applyCompactEventToManager } from '../hooks/useInteractiveSession.js';

describe('compact event bridge', () => {
  it('syncs session history so automatic compaction notifications render', () => {
    const manager = new TuiStateManager();
    const notification = messageToHistoryEntry(
      createSystemMessage('Auto compacted context: 84% -> 35%'),
    );
    const session = {
      getFullHistory: () => [notification],
    };

    applyCompactEventToManager(session, manager);

    expect(manager.history).toEqual([notification]);
  });
});

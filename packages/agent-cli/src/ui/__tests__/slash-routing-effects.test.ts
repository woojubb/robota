import { describe, expect, it } from 'vitest';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { TuiStateManager } from '../tui-state-manager.js';
import { applySystemCommandResult } from '../hooks/useSlashRouting.js';
import type { ISideEffects } from '../hooks/side-effects-types.js';

describe('applySystemCommandResult', () => {
  it('stores statusline settings patch as a CLI side effect', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession & ISideEffects;
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Status line disabled.',
        data: { statuslinePatch: { enabled: false } },
      },
      session,
      manager,
    );

    expect(session._statusLinePatch).toEqual({ enabled: false });
  });
});

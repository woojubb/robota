import { describe, expect, it } from 'vitest';
import type { ICommandInteraction, InteractiveSession } from '@robota-sdk/agent-sdk';
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
        effects: [{ type: 'statusline-settings-patch', patch: { enabled: false } }],
      },
      session,
      manager,
    );

    expect(session._pendingCommandEffects).toEqual([
      { type: 'statusline-settings-patch', patch: { enabled: false } },
    ]);
  });

  it('stores generic command interactions without interpreting command-specific data', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession & ISideEffects;
    const manager = new TuiStateManager();
    const interaction: ICommandInteraction = {
      prompt: {
        kind: 'choice',
        title: 'Change provider?',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
      submit: () => ({ success: true, message: 'done' }),
    };

    applySystemCommandResult(
      {
        success: true,
        message: 'Switch provider?',
        interaction,
      },
      session,
      manager,
    );

    expect(session._pendingCommandInteraction).toBe(interaction);
  });

  it('stores host command side effects', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession & ISideEffects;
    const manager = new TuiStateManager();

    applySystemCommandResult(
      {
        success: true,
        message: 'Opening plugin manager...',
        effects: [{ type: 'plugin-tui-requested' }],
      },
      session,
      manager,
    );

    expect(session._pendingCommandEffects).toEqual([{ type: 'plugin-tui-requested' }]);
  });

  it('applies conversation history clearing immediately before adding the command result', () => {
    const session = {
      getContextState: () => ({ usedPercentage: 0, usedTokens: 0, maxTokens: 0 }),
    } as unknown as InteractiveSession & ISideEffects;
    const manager = new TuiStateManager();
    manager.addEntry({
      id: 'old',
      timestamp: new Date('2026-05-03T00:00:00.000Z'),
      category: 'chat',
      type: 'user',
      data: { role: 'user', content: 'old message' },
    });

    applySystemCommandResult(
      {
        success: true,
        message: 'Conversation cleared.',
        effects: [{ type: 'conversation-history-cleared' }],
      },
      session,
      manager,
    );

    expect(manager.history).toHaveLength(1);
    expect(manager.history[0]?.type).toBe('system');
    expect(manager.history[0]?.data).toMatchObject({ content: 'Conversation cleared.' });
    expect(session._pendingCommandEffects).toBeUndefined();
  });
});

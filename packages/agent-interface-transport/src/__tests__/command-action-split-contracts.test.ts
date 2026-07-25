/**
 * CMD-004 Phase 2 (TC-01) — split command contract type tests.
 *
 * Asserts the final (Stage-E) contract: `TCommandHostAction` / `TCommandUiIntent` are exported,
 * UI-intent names carry no UI-technology token, `ICommandResult` carries ONLY the split fields (the
 * legacy `effects` union is deleted), `IUiIntentEvent` carries `requesterDriverId?`, the `ui_intent` /
 * `session_renamed` / `history_cleared` session events exist, and `executeCommand` accepts the
 * optional command-origin driver id without breaking 2/3-arg callers.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  ICommandResult,
  IInteractiveSession,
  IInteractiveSessionEvents,
  ISessionRenamedEvent,
  IUiIntentEvent,
  TCommandHostAction,
  TCommandUiIntent,
  TDriverId,
} from '../index.js';

describe('CMD-004 Phase 2 split command contract (TC-01)', () => {
  it('exports TCommandHostAction with the nine host-executed kinds', () => {
    // `plugin-registry-reload` was dropped in Stage E: the semantic reload runs INSIDE the command
    // (host-side already); the surface refresh rides `data.pluginRegistryReloaded` (requester-local).
    expectTypeOf<TCommandHostAction['type']>().toEqualTypeOf<
      | 'provider-hot-swap'
      | 'language-change'
      | 'settings-reset'
      | 'session-exit'
      | 'session-restart'
      | 'session-rename'
      | 'statusline-settings-patch'
      | 'remote-control-enable'
      | 'remote-control-stop'
    >();
  });

  it('exports TCommandUiIntent with UI-neutral names (no UI-technology token)', () => {
    expectTypeOf<TCommandUiIntent['type']>().toEqualTypeOf<
      'show-plugin-manager' | 'show-settings' | 'show-session-picker' | 'show-agent-switcher'
    >();
    // Grep-floor at the type level: no intent name may embed a renderer technology.
    type TTechnologyToken =
      `${string}tui${string}` | `${string}ink${string}` | `${string}gui${string}`;
    expectTypeOf<Extract<TCommandUiIntent['type'], TTechnologyToken>>().toEqualTypeOf<never>();
  });

  it('ICommandResult carries ONLY the split fields — the legacy effects union is deleted', () => {
    expectTypeOf<ICommandResult['hostActions']>().toEqualTypeOf<
      readonly TCommandHostAction[] | undefined
    >();
    expectTypeOf<ICommandResult['uiIntents']>().toEqualTypeOf<
      readonly TCommandUiIntent[] | undefined
    >();
    // Stage E: the legacy `effects` field no longer exists on the contract.
    expectTypeOf<'effects' extends keyof ICommandResult ? true : false>().toEqualTypeOf<false>();
  });

  it('IUiIntentEvent carries the intent and the optional requester driver id', () => {
    expectTypeOf<IUiIntentEvent['intent']>().toEqualTypeOf<TCommandUiIntent>();
    expectTypeOf<IUiIntentEvent['requesterDriverId']>().toEqualTypeOf<TDriverId | undefined>();
  });

  it('the session event map carries ui_intent and the session_renamed/history_cleared broadcasts', () => {
    expectTypeOf<IInteractiveSessionEvents['ui_intent']>().toEqualTypeOf<
      (event: IUiIntentEvent) => void
    >();
    expectTypeOf<IInteractiveSessionEvents['session_renamed']>().toEqualTypeOf<
      (event: ISessionRenamedEvent) => void
    >();
    expectTypeOf<IInteractiveSessionEvents['history_cleared']>().toEqualTypeOf<() => void>();
  });

  it('executeCommand accepts the optional command-origin driver id (untouched callers compile)', () => {
    type TExec = IInteractiveSession['executeCommand'];
    expectTypeOf<Parameters<TExec>[3]>().toEqualTypeOf<TDriverId | undefined>();
    // 2- and 3-arg call shapes must remain valid (optional-param design).
    const twoArg: TExec extends (name: string, args: string) => Promise<ICommandResult | null>
      ? true
      : false = true;
    expect(twoArg).toBe(true);
  });

  it('host actions and UI intents are runtime-serializable literals (no function-valued fields)', () => {
    const action: TCommandHostAction = { type: 'session-rename', name: 'renamed' };
    const intent: TCommandUiIntent = { type: 'show-settings' };
    const event: IUiIntentEvent = { intent, requesterDriverId: 'owner' };
    expect(JSON.parse(JSON.stringify({ action, event }))).toEqual({ action, event });
  });
});

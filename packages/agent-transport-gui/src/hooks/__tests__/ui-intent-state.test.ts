/**
 * CMD-004 Stage D (TC-05) — folding a `ui_intent` server message into the GUI state produces either
 * a mapped GUI surface state or an EXPLICIT unsupported-notice entry — NEVER a silent no-op.
 *
 * The GUI presentation core has no full-screen equivalent of the four intents today (no settings
 * screen, session picker, plugin manager, or agent switcher exists in this package), so v1 maps
 * every intent to an explicit user-visible "not available on this surface" notice — the
 * spec-mandated unsupported signal (LSP `showDocument`-style), not a fallback.
 */

import { describe, expect, it } from 'vitest';

import {
  applyUiIntentEvent,
  removeUiIntentNotice,
  type TUiIntentNotice,
} from '../ui-intent-state.js';

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

function intentMessage(intent: TCommandUiIntent, requesterDriverId?: string): TServerMessage {
  return {
    type: 'ui_intent',
    event: { intent, ...(requesterDriverId ? { requesterDriverId } : {}) },
  };
}

const ALL_INTENTS: readonly TCommandUiIntent[] = [
  { type: 'show-plugin-manager' },
  { type: 'show-settings' },
  { type: 'show-session-picker' },
  { type: 'show-agent-switcher' },
];

describe('CMD-004 TC-05 — ui_intent fold (explicit notice, never silent)', () => {
  it('EVERY intent kind folds to a visible entry — none is a silent no-op', () => {
    let notices: readonly TUiIntentNotice[] = [];
    for (const intent of ALL_INTENTS) {
      notices = applyUiIntentEvent(notices, intentMessage(intent));
    }
    expect(notices).toHaveLength(ALL_INTENTS.length);
    for (const [i, notice] of notices.entries()) {
      expect(notice.intentType).toBe(ALL_INTENTS[i]!.type);
      // The explicit unsupported signal the spec mandates (no GUI screen exists for these yet).
      expect(notice.notice).toMatch(/not available on this surface/);
      expect(notice.id.length).toBeGreaterThan(0);
    }
    // Distinct ids so a surface can dismiss one entry without touching the others.
    expect(new Set(notices.map((n) => n.id)).size).toBe(notices.length);
  });

  it('each known intent names its screen in the notice (a user can tell WHAT was requested)', () => {
    const fold = (intent: TCommandUiIntent): string =>
      applyUiIntentEvent([], intentMessage(intent))[0]!.notice;
    expect(fold({ type: 'show-settings' })).toMatch(/settings/i);
    expect(fold({ type: 'show-session-picker' })).toMatch(/session picker/i);
    expect(fold({ type: 'show-plugin-manager' })).toMatch(/plugin manager/i);
    expect(fold({ type: 'show-agent-switcher' })).toMatch(/agent switcher/i);
  });

  it('keeps the requester attribution when stamped', () => {
    const notices = applyUiIntentEvent([], intentMessage({ type: 'show-settings' }, 'device-42'));
    expect(notices[0]!.requesterDriverId).toBe('device-42');
  });

  it('a non-ui_intent message returns the SAME list reference (no churn)', () => {
    const before = applyUiIntentEvent([], intentMessage({ type: 'show-settings' }));
    const after = applyUiIntentEvent(before, { type: 'thinking', isThinking: true });
    expect(after).toBe(before);
  });

  it('an unknown future intent kind STILL yields an explicit notice (wire-level, never silent)', () => {
    const notices = applyUiIntentEvent(
      [],
      intentMessage({ type: 'show-something-new' } as unknown as TCommandUiIntent),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.notice).toMatch(/not available on this surface/);
    expect(notices[0]!.notice).toContain('show-something-new');
  });

  it('removeUiIntentNotice dismisses exactly one entry by id', () => {
    let notices = applyUiIntentEvent([], intentMessage({ type: 'show-settings' }));
    notices = applyUiIntentEvent(notices, intentMessage({ type: 'show-session-picker' }));
    const [first, second] = notices;
    const remaining = removeUiIntentNotice(notices, first!.id);
    expect(remaining).toEqual([second]);
    // Unknown id → same reference (idempotent).
    expect(removeUiIntentNotice(remaining, 'nope')).toBe(remaining);
  });
});

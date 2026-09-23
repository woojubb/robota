/**
 * Issue #2430 — a `hooks.PermissionDecision` command hook never fired while `permissions` from the
 * same settings file took effect. The settings `hooks` schema enumerated thirteen events and
 * `z.object` STRIPS keys it does not name, so the hook was discarded at load, silently, in every
 * mode. This pins the schema to the whole `THookEvent` union: the `Record<THookEvent, true>` below
 * fails to compile when a member is missing or extra, and the runtime loop proves the schema keeps
 * each one.
 */
import { describe, expect, it } from 'vitest';

import { SettingsSchema } from '../config-types.js';

import type { THookEvent } from '@robota-sdk/agent-core';

const EVERY_HOOK_EVENT: Record<THookEvent, true> = {
  PreToolUse: true,
  PostToolUse: true,
  SessionStart: true,
  SessionEnd: true,
  Stop: true,
  StopFailure: true,
  PreCompact: true,
  PostCompact: true,
  UserPromptSubmit: true,
  SubagentStart: true,
  SubagentStop: true,
  WorktreeCreate: true,
  WorktreeRemove: true,
  PreModelCall: true,
  PostModelCall: true,
  PermissionDecision: true,
};

describe('settings hooks schema names every THookEvent (issue #2430)', () => {
  for (const event of Object.keys(EVERY_HOOK_EVENT) as THookEvent[]) {
    it(`keeps a ${event} hook group through parsing`, () => {
      const group = { matcher: '', hooks: [{ type: 'command', command: 'echo ok' }] };
      const result = SettingsSchema.safeParse({ hooks: { [event]: [group] } });
      expect(result.success).toBe(true);
      // The defect was not a refusal — it was a silent strip. Presence after parsing is the claim.
      expect(result.success && result.data.hooks?.[event]).toHaveLength(1);
    });
  }
});

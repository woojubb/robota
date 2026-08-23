/**
 * SEC-015 TC-02 — the shared `{ ok, reason }` decoder.
 *
 * Three executors used to carry three copies of `(body as { ok: boolean }).ok` plus a truthiness
 * test, so a malformed body produced a verdict rather than a failure — and WHICH verdict depended
 * on which side of JavaScript's truthiness the junk fell on. The table below is deliberately
 * exhaustive over both sides, because a decoder tested only on the truthy half would still coerce
 * the falsy half into a denial nobody issued.
 */

import { describe, it, expect } from 'vitest';

import { decodeHookVerdict } from '../verdict-decoder.js';

describe('decodeHookVerdict', () => {
  it('ok === true is allow, carrying the raw text as stdout', () => {
    expect(decodeHookVerdict('{"ok":true}', 'http')).toEqual({
      outcome: 'allow',
      source: 'http',
      stdout: '{"ok":true}',
    });
  });

  it('ok === false is deny with the endpoint reason', () => {
    expect(decodeHookVerdict('{"ok":false,"reason":"because"}', 'prompt')).toEqual({
      outcome: 'deny',
      source: 'prompt',
      reason: 'because',
    });
  });

  it('ok === false with no usable reason denies with a source-named default', () => {
    expect(decodeHookVerdict('{"ok":false}', 'agent')).toEqual({
      outcome: 'deny',
      source: 'agent',
      reason: 'Blocked by agent hook',
    });
    // An empty string is not a reason; it must not become the message a user sees.
    expect(decodeHookVerdict('{"ok":false,"reason":""}', 'agent')).toEqual({
      outcome: 'deny',
      source: 'agent',
      reason: 'Blocked by agent hook',
    });
    // Nor is a non-string.
    expect(decodeHookVerdict('{"ok":false,"reason":42}', 'agent')).toEqual({
      outcome: 'deny',
      source: 'agent',
      reason: 'Blocked by agent hook',
    });
  });

  // The truthy half — each of these USED to be read as allow, silently disabling the gate.
  describe('a truthy non-boolean `ok` is error, never allow', () => {
    it.each([
      ['string "false"', { ok: 'false' }],
      ['string "true"', { ok: 'true' }],
      ['number 1', { ok: 1 }],
      ['object', { ok: {} }],
      ['array', { ok: [] }],
    ])('%s', (_label, body) => {
      const outcome = decodeHookVerdict(JSON.stringify(body), 'http');
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
      expect(outcome.outcome === 'error' && outcome.reason).toContain('not boolean');
    });
  });

  // The falsy half — each of these USED to be read as deny, blocking a tool call on a verdict no
  // hook rendered. This is the direction that is easy to miss, because "it blocked" looks safe.
  describe('a falsy or absent `ok` is error, never deny', () => {
    it.each([
      ['empty object', {}],
      ['null ok', { ok: null }],
      ['number 0', { ok: 0 }],
      ['empty string', { ok: '' }],
      ['undefined ok', { ok: undefined }],
    ])('%s', (_label, body) => {
      const outcome = decodeHookVerdict(JSON.stringify(body), 'http');
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome).not.toBe('deny');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
    });
  });

  describe('a body that is not a JSON object at all is error', () => {
    it.each([
      ['a string', '"hello"'],
      ['a number', '42'],
      ['null', 'null'],
      ['an array', '[]'],
    ])('%s', (_label, raw) => {
      const outcome = decodeHookVerdict(raw, 'http');
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
      expect(outcome.outcome === 'error' && outcome.reason).toContain('not a JSON object');
    });
  });

  it('text that is not JSON at all is error/malformed-response', () => {
    // Folded in from the executors, which each carried their own copy of this branch.
    const outcome = decodeHookVerdict('<html>gateway timeout</html>', 'http');
    expect(outcome.outcome).toBe('error');
    if (outcome.outcome !== 'error') return;
    expect(outcome.kind).toBe('malformed-response');
    expect(outcome.reason).toContain('not valid JSON');
    expect(outcome.reason).toContain('<html>');
  });

  it('quotes the payload back, collapsed and length-capped', () => {
    const noisy = `{\n  "ok":   "maybe",\n  "pad": "${'x'.repeat(500)}"\n}`;
    const outcome = decodeHookVerdict(noisy, 'http');
    expect(outcome.outcome).toBe('error');
    if (outcome.outcome !== 'error') return;
    expect(outcome.reason).not.toContain('\n');
    // Capped so one bad endpoint cannot flood a log, but long enough to identify the payload.
    expect(outcome.reason.length).toBeLessThan(300);
    expect(outcome.reason).toContain('…');
  });

  // ── Regression: an explicit denial survives an undecodable `ok` ────────────────────────────
  //
  // Caught in review, not by me. The first version of this decoder classified the WHOLE body as
  // `error` on the strength of one malformed field, so `{"ok":"false","continue":false}` — an
  // endpoint that explicitly said block — stopped blocking. That is fail-open in an enforcement
  // gate: the same defect as reading `"false"` as approval, pointed the other way.
  describe('an explicit block directive is a verdict even when `ok` is undecodable', () => {
    it('continue: false blocks, carrying stopReason', () => {
      const body = { ok: 'false', continue: false, stopReason: 'nope' };
      expect(decodeHookVerdict(JSON.stringify(body), 'http')).toEqual({
        outcome: 'deny',
        source: 'http',
        reason: 'nope',
      });
    });

    it('continue: false blocks with a default reason when stopReason is absent', () => {
      const body = { ok: 1, continue: false };
      const outcome = decodeHookVerdict(JSON.stringify(body), 'http');
      expect(outcome.outcome).toBe('deny');
      expect(outcome.outcome === 'deny' && outcome.reason).toContain('continue: false');
    });

    it('hookSpecificOutput.permissionDecision: "deny" blocks', () => {
      const body = { ok: 1, hookSpecificOutput: { permissionDecision: 'deny' } };
      const outcome = decodeHookVerdict(JSON.stringify(body), 'http');
      expect(outcome.outcome).toBe('deny');
      expect(outcome.outcome === 'deny' && outcome.reason).toContain('permissionDecision: deny');
    });

    it('decision: "block" blocks, carrying its reason', () => {
      const body = { ok: {}, decision: 'block', reason: 'policy' };
      expect(decodeHookVerdict(JSON.stringify(body), 'prompt')).toEqual({
        outcome: 'deny',
        source: 'prompt',
        reason: 'policy',
      });
    });

    it('a FALSY undecodable `ok` with a directive still blocks', () => {
      // The other truthiness direction: `{}`-shaped bodies used to block by accident. With a real
      // directive present they must block on purpose.
      const body = { ok: null, continue: false };
      expect(decodeHookVerdict(JSON.stringify(body), 'agent').outcome).toBe('deny');
    });

    it('a directive that does NOT request a block leaves the body undecodable', () => {
      // permissionDecision: "allow" is not a block directive, and must not be read as one — nor may
      // its presence rescue a malformed `ok` into an approval.
      const body = { ok: 'maybe', hookSpecificOutput: { permissionDecision: 'allow' } };
      const outcome = decodeHookVerdict(JSON.stringify(body), 'http');
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('malformed-response');
    });
  });

  it('carries the source it was given, unchanged', () => {
    for (const source of ['http', 'prompt', 'agent', 'command', 'guardrail'] as const) {
      expect(decodeHookVerdict('{}', source).source).toBe(source);
    }
  });
});

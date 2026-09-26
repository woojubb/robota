import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  isSessionChangeRefusal,
  SESSION_CHANGE_REFUSAL_CODES,
} from '../session-binding-contracts.js';

import type {
  ISessionBinder,
  ISessionBinding,
  ISessionListingEntry,
  TSessionChangeRefusalCode,
} from '../session-binding-contracts.js';
import type { IResumableSessionSummary } from '../session-summary-contracts.js';

function refusal(code: unknown, name = 'SessionChangeRefusal'): Error {
  return Object.assign(new Error('refused'), { name, code });
}

describe('session change refusal (#3189)', () => {
  it('recognizes a refusal by its name and a declared code', () => {
    for (const code of SESSION_CHANGE_REFUSAL_CODES) {
      expect(isSessionChangeRefusal(refusal(code)), code).toBe(true);
    }
  });

  it('rejects a plain error, a foreign name, an unknown code and a non-error', () => {
    expect(isSessionChangeRefusal(new Error('boom'))).toBe(false);
    expect(isSessionChangeRefusal(refusal('limit', 'TurnNotRunError'))).toBe(false);
    expect(isSessionChangeRefusal(refusal('busy'))).toBe(false);
    expect(isSessionChangeRefusal({ name: 'SessionChangeRefusal', code: 'limit' })).toBe(false);
  });

  it('declares one code type for the codes a decoder can check', () => {
    expectTypeOf<
      (typeof SESSION_CHANGE_REFUSAL_CODES)[number]
    >().toEqualTypeOf<TSessionChangeRefusalCode>();
    expectTypeOf<TSessionChangeRefusalCode>().toEqualTypeOf<
      | 'not_available'
      | 'stopping'
      | 'in_progress'
      | 'prompt_pending'
      | 'unknown_session'
      | 'unreadable'
      | 'start_failed'
      | 'limit'
      | 'failed'
    >();
  });
});

describe('session binding contracts (#3189)', () => {
  it('gives each binding its session, its directory and a release', () => {
    expectTypeOf<ISessionBinder['bind']>().parameter(0).toEqualTypeOf<'drive' | 'observe'>();
    expectTypeOf<ISessionBinding>().toHaveProperty('session');
    expectTypeOf<ISessionBinding>().toHaveProperty('directory');
    expectTypeOf<ISessionBinding>().toHaveProperty('release');
  });

  it('keeps a listing row readable as a plain summary', () => {
    expectTypeOf<ISessionListingEntry>().toMatchTypeOf<IResumableSessionSummary>();
    expectTypeOf<IResumableSessionSummary>().toMatchTypeOf<ISessionListingEntry>();
  });
});

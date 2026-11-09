/**
 * What a secure runtime refuses to be started with: every listener that admits whoever holds a token
 * or a login, and the daemon role, which a certified runtime takes when its owner asks. Each is
 * refused before the host starts, with the reason its surface row states.
 */
import { describe, expect, it } from 'vitest';

import { SECURE_SURFACES } from '../../secure/secure-surfaces.js';
import { secureServeRefusal } from '../secure-serve-refusal.js';

const none = { http: false, open: false, externalEventGrants: false, daemon: false };

function reasonOf(row: 'serve-http' | 'serve-monitor' | 'external-events'): string {
  const secure = SECURE_SURFACES[row].secure;
  if (secure.admit !== 'none') throw new Error(`${row} is expected to be refused in secure mode.`);
  return secure.reason;
}

describe('what a secure runtime refuses at start', () => {
  it('refuses nothing for a runtime that asks for none of them', () => {
    expect(secureServeRefusal(none)).toBeUndefined();
  });

  it.each([
    ['--http', { ...none, http: true }, reasonOf('serve-http')],
    ['--open', { ...none, open: true }, reasonOf('serve-monitor')],
    ['event grants', { ...none, externalEventGrants: true }, reasonOf('external-events')],
  ])('refuses %s with the reason of its surface', (_name, request, reason) => {
    expect(secureServeRefusal(request)).toBe(reason);
  });

  it('refuses --daemon, which a certified runtime becomes at its owner request', () => {
    expect(secureServeRefusal({ ...none, daemon: true })).toMatch(/daemon/u);
  });

  it('names the first thing it refuses, in the order of the listeners the host would open', () => {
    expect(secureServeRefusal({ http: true, open: true, externalEventGrants: true, daemon: true })).toBe(
      reasonOf('serve-http'),
    );
  });
});

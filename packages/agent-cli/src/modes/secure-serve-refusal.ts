import { SECURE_SURFACES } from '../secure/secure-surfaces.js';

import type { TListenerRule } from '../secure/secure-surfaces.js';

/** What a served runtime was asked to open or be. */
export interface ISecureServeRequest {
  readonly http: boolean;
  /** Whether the read-only observer listener was asked for. */
  readonly observer: boolean;
  readonly open: boolean;
  readonly externalEventGrants: boolean;
  readonly daemon: boolean;
}

function reasonOf(rule: TListenerRule): string {
  const { secure } = rule;
  if (secure.admit !== 'none') {
    throw new Error(`The ${rule.surface} listener is not refused in secure mode.`);
  }
  return secure.reason;
}

/**
 * Why a secure runtime refuses this request before its host starts, or `undefined`. Each listener is
 * refused with the reason its surface row states, in the order the host would open them; the daemon
 * role is not a listener: a certified runtime becomes its workspace's daemon when its owner asks.
 */
export function secureServeRefusal(request: ISecureServeRequest): string | undefined {
  if (request.observer) return reasonOf(SECURE_SURFACES['websocket-transport']);
  if (request.http) return reasonOf(SECURE_SURFACES['serve-http']);
  if (request.open) return reasonOf(SECURE_SURFACES['serve-monitor']);
  if (request.externalEventGrants) return reasonOf(SECURE_SURFACES['external-events']);
  if (request.daemon) {
    return 'A secure runtime does not start as a daemon: it becomes its workspace daemon when its owner asks, over an owner link.';
  }
  return undefined;
}

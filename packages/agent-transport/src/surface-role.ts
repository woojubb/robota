import { isObserverMessageType } from './observer-messages.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TClientMessage, TSessionSurfaceRole } from './wire-messages.js';

/** Why a requested role was refused. */
export type TSurfaceRoleRefusal = 'role-not-granted' | 'unsupported-role';

/** The outcome of {@link resolveSurfaceRole}: the effective role, or why the request was refused. */
export type TSurfaceRoleDecision =
  | { readonly ok: true; readonly role: TSessionSurfaceRole }
  | { readonly ok: false; readonly reason: TSurfaceRoleRefusal };

/**
 * The one role decision for every carrier: the host's grant, lowered when the client asks for less and
 * never raised. Pure; never throws, whatever the client sent.
 */
export function resolveSurfaceRole(
  grant: TSessionSurfaceRole,
  request?: unknown,
): TSurfaceRoleDecision {
  if (request === undefined) return { ok: true, role: grant };
  if (request === 'observe') return { ok: true, role: 'observe' };
  if (request === 'drive') {
    return grant === 'drive'
      ? { ok: true, role: 'drive' }
      : { ok: false, reason: 'role-not-granted' };
  }
  return { ok: false, reason: 'unsupported-role' };
}

/**
 * The one guard for every inbound path: answers `get-surface-role` and refuses what an observer may
 * not send. Returns true when the message is settled here; false means the caller routes it.
 */
export function handleSurfaceRoleMessage(
  role: TSessionSurfaceRole,
  msg: TClientMessage,
  deliver: TOutboundDeliver,
): boolean {
  if (msg.type === 'get-surface-role') {
    deliver({ type: 'surface_role', role });
    return true;
  }
  if (role === 'observe' && !isObserverMessageType(msg.type)) {
    deliver({ type: 'protocol_error', message: `Not permitted for an observer: ${msg.type}` });
    return true;
  }
  return false;
}

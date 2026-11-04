/**
 * The one way a session store is decorated (#3679 step 3e): a view that replaces some of the port's
 * calls and forwards every other member exactly as the store has it.
 *
 * The members are listed once, held by the compiler to the port's own keys, so a member added to the
 * port cannot be left out of a view without the build saying so. A member a decorator forgot to
 * forward is how a view used to switch a store's guarantees off; here it cannot be forgotten.
 */

import type { IInteractiveSessionStore } from './session-persistence.js';

type TStoreMember = keyof IInteractiveSessionStore;

/** Every member of the port, once. */
const STORE_MEMBERS = {
  save: true,
  load: true,
  list: true,
  scan: true,
  loadHeld: true,
  exportHeld: true,
  importHeld: true,
  claim: true,
  hasWriter: true,
  authorship: true,
  delete: true,
} as const satisfies Record<TStoreMember, true>;

/** The calls a view replaces, each with the port member's own signature. */
export type TSessionStoreOverrides = Partial<Omit<IInteractiveSessionStore, 'authorship'>>;

/**
 * `store`, with the calls `overrides` names replaced and every other member forwarded as the store has
 * it: a method is called on the store itself, the `authorship` member is the store's own, and a member
 * the store does not have is not on the view either.
 */
export function decorateSessionStore(
  store: IInteractiveSessionStore,
  overrides: TSessionStoreOverrides,
): IInteractiveSessionStore {
  const view: Partial<Record<TStoreMember, unknown>> = {};
  for (const member of Object.keys(STORE_MEMBERS) as TStoreMember[]) {
    const replaced = member === 'authorship' ? undefined : overrides[member];
    if (replaced !== undefined) {
      view[member] = replaced;
      continue;
    }
    const own: unknown = store[member];
    if (own === undefined) continue;
    view[member] =
      typeof own === 'function' ? (own as (...args: unknown[]) => unknown).bind(store) : own;
  }
  return view as IInteractiveSessionStore;
}

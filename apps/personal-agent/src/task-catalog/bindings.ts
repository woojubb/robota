/**
 * What the host has verified a capability can do. A binding ties one semantic operation, such as
 * `mail.search`, to the adapter that carries it, the account and the exact tool, the plain-language
 * boundary on what may be passed to it, and its effect. Only host code makes one: `issueBinding`
 * checks the shape and records the value it returned, so a value rebuilt from any text, however
 * well formed, is not a binding. A service's tool names, descriptions and read-only hints, a
 * definition's wording and an offer's reason are all text, and none of them reaches this module.
 */
import { TaskCatalogRefusedError, oneOf, plainLine, shaped } from './fields.js';
import { EFFECT_CEILINGS } from './types.js';

import type { TEffectCeiling } from './types.js';

export type TBindingAdapter = 'local-browser' | 'connector';

export interface ICapabilityBinding {
  /** The operation, such as `mail.search`; one of `BINDABLE_CAPABILITIES`. */
  readonly capability: string;
  readonly adapter: TBindingAdapter;
  /** The connector's id; absent for the local browser, and for a connector binding no account serves yet. */
  readonly account?: string;
  /** The exact tool of a connector; a binding never names a tool by pattern. */
  readonly tool?: string;
  /** What may be passed to it, in a short plain-language line the person reads before starting. */
  readonly argumentBoundary: string;
  readonly effect: TEffectCeiling;
}

declare const ISSUED_BY_HOST: unique symbol;

/** A binding the host issued. A plain `ICapabilityBinding` is not assignable to it. */
export type TBindingSource = Readonly<ICapabilityBinding> & { readonly [ISSUED_BY_HOST]: true };

/**
 * The operations the host can verify, with the adapters that may carry each. A capability that is not
 * here has no way to be bound, whatever a service offers: adding one is a change to the host.
 */
export const BINDABLE_CAPABILITIES: Readonly<Record<string, readonly TBindingAdapter[]>> = {
  'web.read': ['local-browser'],
  'mail.search': ['connector'],
  'mail.read': ['connector'],
  'mail.draft': ['connector'],
  'calendar.read': ['connector'],
};

export const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const BOUNDARY_MAX = 160;

const issued = new WeakSet<object>();

/** How much a binding may do, as a position: a larger number does more. */
export function effectRank(effect: TEffectCeiling): number {
  return EFFECT_CEILINGS.indexOf(effect);
}

/** Whether work with this effect goes beyond a ceiling. */
export function effectExceeds(effect: TEffectCeiling, ceiling: TEffectCeiling): boolean {
  return effectRank(effect) > effectRank(ceiling);
}

/** A binding the host made and nothing else made, as the host recorded it. */
export function isIssuedBinding(value: unknown): value is TBindingSource {
  return typeof value === 'object' && value !== null && issued.has(value);
}

/**
 * Check a binding's shape and give it back as plain data, issuing nothing. An unknown capability, an
 * adapter that cannot carry it, an unknown effect, a missing or stray tool or account, and a boundary
 * that is empty, long or secret-shaped are refused, so a mistaken table fails when the host starts and
 * not when a card is shown. A binding kept in a record is read back through this, never issued again.
 */
export function checkBindingSpec(spec: ICapabilityBinding): ICapabilityBinding {
  const capability = oneOf(spec.capability, 'capability', Object.keys(BINDABLE_CAPABILITIES));
  const adapter = oneOf(spec.adapter, `${capability} adapter`, BINDABLE_CAPABILITIES[capability]!);
  const effect = oneOf(spec.effect, `${capability} effect`, EFFECT_CEILINGS);
  const argumentBoundary = plainLine(spec.argumentBoundary, 'argumentBoundary', BOUNDARY_MAX);
  if (adapter === 'local-browser' && (spec.account !== undefined || spec.tool !== undefined))
    throw new TaskCatalogRefusedError(
      `${capability} is carried by the browser, not an account or tool`,
    );
  if (adapter === 'connector' && spec.tool === undefined)
    throw new TaskCatalogRefusedError(`${capability} must name the exact tool of its connector`);
  return {
    capability,
    adapter,
    ...(spec.account !== undefined && {
      account: shaped(spec.account, `${capability} account`, CONNECTOR_ID, 80),
    }),
    ...(spec.tool !== undefined && {
      tool: shaped(spec.tool, `${capability} tool`, TOOL_NAME, 128),
    }),
    argumentBoundary,
    effect,
  };
}

/** Check a binding and issue it: only host code calls this, and only its result counts as verified. */
export function issueBinding(spec: ICapabilityBinding): TBindingSource {
  const binding = Object.freeze(checkBindingSpec(spec)) as TBindingSource;
  issued.add(binding);
  return binding;
}

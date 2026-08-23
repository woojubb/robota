/**
 * HARNESS-103: the session-capability host MECHANISM, moved out of the interface package's
 * contract surface.
 *
 * `.agents/project-structure.md` states that an `agent-interface-*` package "must not contain
 * classes or runtime logic", and this file is 100 lines of prototype walking, accessor caching,
 * reserved/duplicate-member rejection and freezing. It passed `scan-interface-runtime` only because
 * that scan detected `class`/`enum` declarations and bare value imports — a narrower thing than the
 * rule it enforces — so a factory function full of runtime behaviour sat outside the rule and
 * inside the green.
 *
 * It lives under `testing/` rather than in an implementation package because that is what the
 * repository's own placement rule prescribes for what it actually is: its only consumers are this
 * package's own unit test and the `testing` subpath's `createTestSessionCapabilityHost`. There is
 * no production consumer — verified by grepping every package and app source tree — so it is a
 * double factory, and the rule reads `doubles→owner /testing`.
 *
 * The CONTRACTS it satisfies (`ISessionCapabilityHost`, `TSessionCapabilityHost`,
 * `TSessionCapabilityReadResult`) stayed in `session-capability-contracts.ts`, where contracts go.
 */

import { SESSION_CAPABILITY_MEMBER_KEYS } from '@robota-sdk/agent-interface-session';

import type {
  ISessionCapabilityMap,
  ISessionCapabilityHost,
  TSessionCapabilityHost,
  TSessionCapabilityReadResult,
} from '@robota-sdk/agent-interface-session';

function findPropertyDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current !== null && current !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function forwardCapabilityMember(input: {
  host: object;
  capability: object;
  capabilityKey: keyof ISessionCapabilityMap;
  memberKey: PropertyKey;
  forwarded: Set<PropertyKey>;
}): void {
  const { host, capability, capabilityKey, memberKey, forwarded } = input;
  if (memberKey === 'constructor' || memberKey === 'capabilities' || memberKey === '__proto__') {
    throw new TypeError(`Reserved session capability member: ${String(memberKey)}`);
  }
  if (forwarded.has(memberKey)) {
    throw new TypeError(`Duplicate session capability member: ${String(memberKey)}`);
  }
  const descriptor = findPropertyDescriptor(capability, memberKey);
  if (!descriptor) {
    throw new TypeError(`Missing ${String(capabilityKey)} capability member: ${String(memberKey)}`);
  }
  let cachedFunction: ((...args: never[]) => unknown) | undefined;
  const forwardedDescriptor: PropertyDescriptor =
    'value' in descriptor && typeof descriptor.value === 'function'
      ? { value: descriptor.value.bind(capability), writable: false }
      : {
          get: () => {
            const value = Reflect.get(capability, memberKey, capability);
            if (typeof value !== 'function') return value;
            cachedFunction ??= value.bind(capability);
            return cachedFunction;
          },
        };
  Object.defineProperty(host, memberKey, {
    ...forwardedDescriptor,
    configurable: false,
    enumerable: true,
  });
  forwarded.add(memberKey);
}

export function createSessionCapabilityHost<
  const TCapabilities extends Partial<ISessionCapabilityMap>,
>(capabilities: TCapabilities): TSessionCapabilityHost<TCapabilities> {
  const host: object = Object.create(null);
  const forwarded = new Set<PropertyKey>();
  const knownCapabilityKeys = new Set<PropertyKey>(Object.keys(SESSION_CAPABILITY_MEMBER_KEYS));
  for (const key of Reflect.ownKeys(capabilities)) {
    if (!knownCapabilityKeys.has(key)) {
      throw new TypeError(`Unknown session capability: ${String(key)}`);
    }
  }
  const canonicalCapabilities: Partial<ISessionCapabilityMap> = Object.create(null);
  for (const capabilityKey of Reflect.ownKeys(capabilities) as (keyof ISessionCapabilityMap)[]) {
    const capability = Reflect.get(capabilities, capabilityKey, capabilities);
    if (capability === undefined) continue;
    Object.defineProperty(canonicalCapabilities, capabilityKey, {
      configurable: false,
      enumerable: true,
      value: capability,
      writable: false,
    });
    for (const memberKey of SESSION_CAPABILITY_MEMBER_KEYS[capabilityKey]) {
      forwardCapabilityMember({ host, capability, capabilityKey, memberKey, forwarded });
    }
  }
  Object.freeze(canonicalCapabilities);
  Object.defineProperty(host, 'capabilities', {
    configurable: false,
    enumerable: true,
    value: canonicalCapabilities as Readonly<TCapabilities>,
    writable: false,
  });
  return host as TSessionCapabilityHost<TCapabilities>;
}

export function readSessionCapability<
  TCapabilities extends Partial<ISessionCapabilityMap>,
  TKey extends keyof ISessionCapabilityMap,
>(
  host: Readonly<{ capabilities: TCapabilities }>,
  key: TKey,
): TSessionCapabilityReadResult<ISessionCapabilityMap[TKey]> {
  const value = host.capabilities[key];
  return value === undefined
    ? { provided: false }
    : { provided: true, value: value as ISessionCapabilityMap[TKey] };
}

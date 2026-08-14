import { SESSION_CAPABILITY_MEMBER_KEYS } from './session-capability-contracts.js';

import type { ISessionCapabilityMap } from './session-capability-contracts.js';

type TUnionToIntersection<T> = (T extends T ? (value: T) => void : never) extends (
  value: infer TIntersection,
) => void
  ? TIntersection
  : never;

type TSelectedSessionPorts<TCapabilities extends Partial<ISessionCapabilityMap>> =
  TUnionToIntersection<Exclude<TCapabilities[keyof TCapabilities], undefined>>;

export interface ISessionCapabilityHost<
  TCapabilities extends Partial<ISessionCapabilityMap> = Partial<ISessionCapabilityMap>,
> {
  readonly capabilities: Readonly<TCapabilities>;
}

export type TSessionCapabilityHost<TCapabilities extends Partial<ISessionCapabilityMap>> =
  ISessionCapabilityHost<TCapabilities> & TSelectedSessionPorts<TCapabilities>;

export type TSessionCapabilityReadResult<TCapability> =
  Readonly<{ provided: false }> | Readonly<{ provided: true; value: TCapability }>;

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

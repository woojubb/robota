import type { IEmbeddedProductIdentity, TConfigEnvironment } from './contract.js';

const canonicalFamily = /^(?:PRODUCT|PROJECT|SERVICE|SECURITY|DEPLOY)_/u;

/** Ambient canonical inputs belong only to the product that stamped this environment. */
export function scopeProductEnvironment(
  environment: TConfigEnvironment,
  identity: IEmbeddedProductIdentity,
): TConfigEnvironment {
  if (environment.PRODUCT_ID === identity.identity.id) return environment;
  return Object.freeze(
    Object.fromEntries(Object.entries(environment).filter(([key]) => !canonicalFamily.test(key))),
  );
}

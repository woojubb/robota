import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_ENTITLEMENTS,
  REQUIRED_ENTITLEMENTS,
  assertEntitlementPolicy,
  entitlementKeys,
} from '../macos-entitlements.mjs';

const plist = readFileSync(fileURLToPath(new URL('../bun-entitlements.plist', import.meta.url)), {
  encoding: 'utf8',
});

const xmlWith = (keys) =>
  `<plist version="1.0"><dict>${keys.map((key) => `<key>${key}</key><true/>`).join('')}</dict></plist>`;

describe('macOS runtime entitlement policy', () => {
  it('signs with no forbidden entitlement', () => {
    const keys = entitlementKeys(plist);
    expect(FORBIDDEN_ENTITLEMENTS.filter((key) => keys.has(key))).toEqual([]);
  });

  it('signs with the JIT entitlements the Bun runtime needs', () => {
    const keys = entitlementKeys(plist);
    expect(REQUIRED_ENTITLEMENTS.filter((key) => !keys.has(key))).toEqual([]);
  });

  it('refuses a dynamic-loader environment entitlement, whatever its value', () => {
    expect(FORBIDDEN_ENTITLEMENTS).toContain(
      'com.apple.security.cs.allow-dyld-environment-variables',
    );
    const withIt = xmlWith([...REQUIRED_ENTITLEMENTS, ...FORBIDDEN_ENTITLEMENTS]);
    expect(() => assertEntitlementPolicy(withIt, 'binary')).toThrow(/allow-dyld-environment/);
    expect(() =>
      assertEntitlementPolicy(withIt.replaceAll('<true/>', '<false/>'), 'binary'),
    ).toThrow(/allow-dyld-environment/);
  });

  it('refuses an entitlement dump that is empty or lacks the JIT grants', () => {
    expect(() => assertEntitlementPolicy('', 'binary')).toThrow(/missing: .*allow-jit/);
    expect(() =>
      assertEntitlementPolicy(xmlWith(REQUIRED_ENTITLEMENTS.slice(1)), 'binary'),
    ).toThrow(/missing: com.apple.security.cs.allow-jit/);
  });

  it('accepts exactly what the release signs with', () => {
    expect(() => assertEntitlementPolicy(plist, 'binary')).not.toThrow();
  });
});

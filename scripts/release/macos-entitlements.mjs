// The entitlement policy for the signed macOS Bun runtime. `bun-entitlements.plist` is what the
// release signs with; the unit test and the post-sign check both read the lists below, so a
// regression has one place to be decided.

// allow-dyld-environment-variables makes the dynamic loader honour DYLD_INSERT_LIBRARIES, so any
// process of the same user could make the signed binary load a library of its choosing at launch.
export const FORBIDDEN_ENTITLEMENTS = ['com.apple.security.cs.allow-dyld-environment-variables'];

// The JIT grants JavaScriptCore needs inside the hardened runtime. Also what makes an empty or
// unparseable entitlement dump fail the post-sign check instead of passing it vacuously.
export const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-executable-page-protection',
];

/** Entitlement names present in an XML property list. A key counts as present whatever its value. */
export function entitlementKeys(xml) {
  return new Set([...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]));
}

/** Throws unless the XML entitlement list carries every required key and no forbidden one. */
export function assertEntitlementPolicy(xml, subject) {
  const keys = entitlementKeys(xml);
  const forbidden = FORBIDDEN_ENTITLEMENTS.filter((key) => keys.has(key));
  const missing = REQUIRED_ENTITLEMENTS.filter((key) => !keys.has(key));
  if (forbidden.length || missing.length) {
    const problems = [
      forbidden.length ? `forbidden: ${forbidden.join(', ')}` : '',
      missing.length ? `missing: ${missing.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(
      `${subject} violates the macOS entitlement policy (${problems.join('; ')}); no release artifact may be published.`,
    );
  }
}

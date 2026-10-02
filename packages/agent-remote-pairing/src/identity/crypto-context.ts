/** Public domain separation data. No keys, environment access, or process-wide selected product. */
export interface IIdentityContext {
  readonly namespace: string;
  readonly purposes: Readonly<Record<keyof typeof PURPOSE_SUFFIXES, string>>;
}

const PURPOSE_SUFFIXES = {
  signingKeyCert: 'signing-key-cert/v1',
  deviceCert: 'device-cert/v1',
  roster: 'roster/v1',
  revocation: 'revocation/v1',
  signingKeyRevocation: 'signing-key-revocation/v1',
  sessionDesc: 'session-desc/v1',
  handshake: 'handshake/v1',
  enrollProof: 'enroll-proof/v1',
  enrollRequest: 'enroll-request/v1',
  enrollCommit: 'enroll-commit/v1',
  enrollSas: 'enroll-sas/v1',
} as const;

/** Bind protocol purposes to a host-selected, non-secret namespace. */
export function createIdentityContext(namespace: string): IIdentityContext {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(namespace)) {
    throw new Error('identity context: a valid namespace is required');
  }
  const purposes = Object.fromEntries(
    Object.entries(PURPOSE_SUFFIXES).map(([key, suffix]) => [key, `${namespace}/${suffix}`]),
  ) as Record<keyof typeof PURPOSE_SUFFIXES, string>;
  return Object.freeze({ namespace, purposes: Object.freeze(purposes) });
}

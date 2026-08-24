/**
 * Issue #2023: an org policy file that EXISTS and cannot be understood is an error condition, never
 * silently equated with a missing one.
 *
 * The loader returned `null` for both, and every enforcement site reads `null` as "no policy
 * configured" — `orgPolicy?.allowedProviders && …` does not fire when the policy is absent. So a
 * corrupted file removed provider allowlisting, blocked commands and the plaintext-key requirement
 * at once, with no signal, and produced behaviour identical to having deployed no policy at all.
 * An administrator could not tell those apart.
 *
 * This mirrors `SettingsParseError` (CLI-069) and the trusted-device store, which answer the same
 * question the same way one and two files over. The sanctioned-degradation comment it replaces was
 * not wrong to care about startup — a MISSING policy still returns `null` and still does not throw,
 * which is the common case. What changes is the case where an administrator deployed a file and it
 * cannot be read.
 */
export class OrgPolicyParseError extends Error {
  readonly filePath: string;

  constructor(filePath: string, reason: string) {
    super(
      `Organization policy file ${filePath} could not be read as a policy: ${reason}. ` +
        'Policy is NOT applied while this file is unreadable. Fix or remove the file.',
    );
    this.name = 'OrgPolicyParseError';
    this.filePath = filePath;
  }
}

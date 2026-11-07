/**
 * What every org-policy enforcement site says and checks, with nothing that reads a policy file:
 * the session, its host actions and the provider commands all need these on a platform that has no
 * file system, so they stay apart from the loader that does.
 */

/** A refusal's reason, followed by the administrator to contact when the policy names one. */
export function formatOrgPolicyViolationMessage(
  reason: string,
  adminContact: string | undefined,
): string {
  const contact = adminContact ? `\nContact your administrator: ${adminContact}` : '';
  return `${reason}${contact}`;
}

/** Whether `apiKey` is a literal key rather than an `$ENV:` reference; an absent key is neither. */
export function isApiKeyPlaintext(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  return !apiKey.startsWith('$ENV:');
}

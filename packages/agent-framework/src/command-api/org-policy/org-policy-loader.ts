import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { OrgPolicyParseError } from './org-policy-parse-error.js';

import type { IOrgPolicy } from './org-policy-types.js';
import type { IUniversalObjectValue, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Read the organization policy, or `null` when none is deployed.
 *
 * **`null` means "no policy file", and nothing else** (issue #2023). Every enforcement site spells
 * its guard `orgPolicy?.<field> && <violation>`, so `null` is read as "no restrictions" — which is
 * correct for an administrator who deployed no policy and catastrophic for one whose policy file was
 * truncated by a partial write or mangled by a sync tool. Returning `null` for both made those two
 * indistinguishable, and the second silently removed provider allowlisting, blocked commands and the
 * plaintext-key requirement together.
 *
 * A file that EXISTS and cannot be understood therefore throws. That answers the concern the
 * sanctioned-degradation comment here used to state — "malformed org-policy.json must not crash CLI
 * startup" — rather than deleting it: a **missing** file is the common case and still returns `null`
 * without throwing. What throws is a file an administrator put there that cannot be read, which is
 * their error to see.
 *
 * `settings-io.ts` (CLI-069) and the trusted-device store answer the same question the same way, one
 * and two files over. This loader was the one that did not.
 */
export function loadOrgPolicy(): IOrgPolicy | null {
  const policyPath = join(homedir(), '.robota', 'org-policy.json');
  if (!existsSync(policyPath)) return null;
  let parsed: TUniversalValue;
  try {
    parsed = JSON.parse(readFileSync(policyPath, 'utf8')) as TUniversalValue;
  } catch (error) {
    // allow-fallback: rethrown as a typed OrgPolicyParseError — fail-closed, not a fallback
    throw new OrgPolicyParseError(
      policyPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  const shapeProblem = describeShapeProblem(parsed);
  if (shapeProblem !== undefined) throw new OrgPolicyParseError(policyPath, shapeProblem);
  return parsed as IOrgPolicy;
}

/**
 * Why valid JSON of the wrong shape is refused rather than accepted.
 *
 * `JSON.parse(raw) as IOrgPolicy` asserted a shape it never checked, and the enforcement sites read
 * whatever came back. `{"allowedProviders": "anthropic"}` — a string where an array belongs — is
 * truthy, so the guard fires, and `"anthropic".includes(name)` then matches on SUBSTRING: a profile
 * named `ant` passes an allowlist that names only `anthropic`. A policy that mis-enforces is worse
 * than one that does not load, because it looks like it is working.
 *
 * Checked structurally rather than with a schema: `IOrgPolicy` is a hand-written interface and its
 * ownership stays there. A schema here would make this file the type's source of truth as a side
 * effect of validating it.
 */
function describeShapeProblem(value: TUniversalValue): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `expected a JSON object, found ${Array.isArray(value) ? 'an array' : typeof value}`;
  }
  const record = value as IUniversalObjectValue;
  for (const field of ['allowedProviders', 'blockedCommands'] as const) {
    const held = record[field];
    if (held === undefined) continue;
    if (!Array.isArray(held) || held.some((entry) => typeof entry !== 'string')) {
      return `\`${field}\` must be an array of strings`;
    }
  }
  if (
    record.requireApiKeyFromEnv !== undefined &&
    typeof record.requireApiKeyFromEnv !== 'boolean'
  ) {
    return '`requireApiKeyFromEnv` must be a boolean';
  }
  if (record.adminContact !== undefined && typeof record.adminContact !== 'string') {
    return '`adminContact` must be a string';
  }
  return undefined;
}

export function formatOrgPolicyViolationMessage(
  reason: string,
  adminContact: string | undefined,
): string {
  const contact = adminContact ? `\nContact your administrator: ${adminContact}` : '';
  return `${reason}${contact}`;
}

export function isApiKeyPlaintext(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  return !apiKey.startsWith('$ENV:');
}

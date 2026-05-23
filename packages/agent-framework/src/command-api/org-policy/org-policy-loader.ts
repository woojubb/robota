import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { IOrgPolicy } from './org-policy-types.js';

export function loadOrgPolicy(): IOrgPolicy | null {
  const policyPath = join(homedir(), '.robota', 'org-policy.json');
  if (!existsSync(policyPath)) return null;
  try {
    const raw = readFileSync(policyPath, 'utf8');
    return JSON.parse(raw) as IOrgPolicy;
  } catch {
    // allow-fallback: malformed org-policy.json must not crash CLI startup
    return null;
  }
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

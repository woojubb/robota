/**
 * The doctor's single rendering boundary for secrets (OBSERVABILITY-1991).
 *
 * Defence in depth, not the first line: the inspection APIs the probes read already return facts
 * (states, paths, issue paths, env KEY names) rather than file content. This pass exists for the
 * text the doctor cannot prevent from carrying a value — an owner error message, a URL a user typed
 * a credential into — and for the case the structural layer cannot see: a literal that IS a secret
 * because the settings layers or the environment say so.
 */

import { SettingsParseError } from '@robota-sdk/agent-framework';

import type { TSettings } from '@robota-sdk/agent-framework';

const REDACTED = '[redacted]';

/** `scheme://user:pass@host` → `scheme://[redacted]@host`. */
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)([^\s/@]+)@/gi;
/** `Bearer <token>` in any casing. */
const BEARER_TOKEN = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** Vendor-key shapes: `sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`, `xox?-…`. */
const KEY_SHAPES =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})\b/g;

const MIN_SECRET_LENGTH = 4;
/** The quoted excerpt of the input a JSON parser embeds in its message: `..."<snippet>"...`. */
const PARSER_SNIPPET = /\.\.\."[^"]*"\.\.\./g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask every known secret value and every credential-shaped token in `text`.
 *
 * `secrets` are literal values the doctor learned from its inputs — the resolved credential, every
 * literal `apiKey` in any settings layer (active or not), every value a `$ENV:` reference names,
 * every `env` map value. Values shorter than four characters are not masked: they cannot be
 * credentials and masking them would shred ordinary words.
 */
export function redactDiagnosticText(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  const seen = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH || seen.has(secret))
      continue;
    seen.add(secret);
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  }
  out = out.replace(URL_USERINFO, `$1${REDACTED}@`);
  out = out.replace(BEARER_TOKEN, `$1 ${REDACTED}`);
  out = out.replace(KEY_SHAPES, REDACTED);
  return out;
}

/**
 * An owner error as the doctor may show it. A parse error is named by its class and file only —
 * its message quotes the file around the fault, which is exactly the content a broken settings
 * layer never had a chance to contribute to the secret list. Any other message loses a parser
 * snippet it may carry; the redactor still runs over the result.
 */
export function describeDiagnosticError(error: Error): string {
  if (error instanceof SettingsParseError) {
    return `${error.name}: ${error.filePath} is not valid JSON (see the settings check)`;
  }
  return `${error.name}: ${error.message.replace(PARSER_SNIPPET, '…')}`;
}

/**
 * Collect the literal secrets a set of parsed settings layers and the environment expose:
 * `providers.*.apiKey`, `provider.apiKey` (literal, or the value of a `$ENV:` reference), and
 * every `env` map value. The doctor never RENDERS any of these; they feed the redactor so that a
 * value which nonetheless reaches a message is masked.
 */
export function collectSettingsSecrets(
  layers: ReadonlyArray<TSettings | undefined>,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const secrets = new Set<string>();
  const addKey = (value: string | undefined): void => {
    if (value === undefined) return;
    if (value.startsWith('$ENV:')) {
      const resolved = env[value.slice('$ENV:'.length).trim()];
      if (resolved !== undefined) secrets.add(resolved);
      return;
    }
    secrets.add(value);
  };
  for (const layer of layers) {
    if (layer === undefined) continue;
    addKey(layer.provider?.apiKey);
    for (const profile of Object.values(layer.providers ?? {})) addKey(profile.apiKey);
    for (const value of Object.values(layer.env ?? {})) secrets.add(value);
  }
  return [...secrets];
}

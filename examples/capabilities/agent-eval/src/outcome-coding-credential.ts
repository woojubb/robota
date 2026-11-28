import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

/**
 * The gateway credential for a paid run: read once from one named line of a file the caller
 * names, held in memory inside an object that prints as redacted, and never written anywhere. The
 * worker container takes no environment variable and no mount for it, so it only ever reaches the
 * host's upstream client. The leak scan reports how many times a secret (raw or in a common
 * encoding) appears in the evidence, and never the secret itself.
 */

const REDACTED = '[redacted credential]';

export interface ICredential {
  /** The secret, for the one place that sends it. */
  reveal(): string;
}

class HeldCredential implements ICredential {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/** Wraps a secret so it cannot be printed or serialized by accident. */
export function holdCredential(value: string): ICredential {
  if (value.length === 0) throw new Error('The credential is empty');
  return new HeldCredential(value);
}

function stripQuotes(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Reads the value of the one line `NAME=value` (an optional `export ` prefix and one pair of
 * quotes are accepted) from a file. Every other line is ignored and discarded; the file's text is
 * not kept. A missing, repeated or empty line fails with a message that names the line, never the
 * value or any other content.
 */
export function readCredentialLine(path: string, name: string): ICredential {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw new Error('The credential line name is invalid');
  const prefix = `${name}=`;
  let found: string | undefined;
  let matches = 0;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trimStart().replace(/^export\s+/, '');
    if (!line.startsWith(prefix)) continue;
    matches += 1;
    found = stripQuotes(line.slice(prefix.length).trim());
  }
  if (matches === 0) throw new Error(`The credential file has no ${name} line`);
  if (matches > 1) throw new Error(`The credential file has more than one ${name} line`);
  if (found === undefined || found.length === 0) throw new Error(`The ${name} line is empty`);
  return holdCredential(found);
}

/** The ways a secret may show up in text: as is, in base64 or base64url, in hex, and URL-encoded. */
function encodings(secret: string): string[] {
  const buffer = Buffer.from(secret, 'utf8');
  const forms = new Set<string>([
    secret,
    buffer.toString('base64'),
    buffer.toString('base64').replace(/=+$/, ''),
    buffer.toString('base64url'),
    buffer.toString('hex'),
    encodeURIComponent(secret),
    JSON.stringify(secret).slice(1, -1),
  ]);
  return [...forms].filter((form) => form.length > 0);
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** How many times the secret appears in the given texts, in any scanned form. */
export function countLeaksInTexts(secret: string, texts: Iterable<string | Buffer>): number {
  const forms = encodings(secret);
  const byteForms = forms.map((form) => Buffer.from(form, 'utf8').toString('latin1'));
  let count = 0;
  for (const text of texts) {
    if (typeof text === 'string') {
      for (const form of forms) count += occurrences(text, form);
    } else {
      const haystack = text.toString('latin1');
      for (const form of byteForms) count += occurrences(haystack, form);
    }
  }
  return count;
}

const MAX_SCANNED_FILE_BYTES = 64 * 1024 * 1024;

/** The same count over every regular file under a path, links not followed; unreadable files count as errors. */
export function countLeaksInPath(
  secret: string,
  root: string,
): { readonly leaks: number; readonly filesScanned: number; readonly unreadable: number } {
  let leaks = 0;
  let filesScanned = 0;
  let unreadable = 0;
  const visit = (path: string): void => {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      unreadable += 1;
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      let names: string[];
      try {
        names = readdirSync(path);
      } catch {
        unreadable += 1;
        return;
      }
      for (const name of names) visit(join(path, name));
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > MAX_SCANNED_FILE_BYTES) {
      unreadable += 1;
      return;
    }
    try {
      leaks += countLeaksInTexts(secret, [readFileSync(path)]);
      filesScanned += 1;
    } catch {
      unreadable += 1;
    }
  };
  visit(root);
  return { leaks, filesScanned, unreadable };
}

/** Replaces every scanned form of the secret in a text, for messages that may echo a request. */
export function redactSecret(secret: string, text: string): string {
  let result = text;
  for (const form of encodings(secret).sort((a, b) => b.length - a.length)) {
    result = result.split(form).join(REDACTED);
  }
  return result;
}

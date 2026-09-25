/**
 * What counts as a secret in an MCP definition — one principle for every consumer.
 *
 * A value is secret because of what it is, not because of which field carries it: a stretch that a
 * credential-shaped variable produced is secret wherever it lands, and a value under a
 * credential-shaped env or header key is secret as a whole, because a literal credential has no
 * variable to trace. The fingerprint, the activation endpoint and the projections all read this.
 *
 * What is printed is also scanned for literal credentials by their shape; that guess is display-only.
 */

import type { IMCPServerDefinitionResolved } from './types.js';

/** Name segments that mark a credential, matched whole — so `KEYBOARD` and `AUTHOR` are not. */
const CREDENTIAL_SEGMENTS: ReadonlySet<string> = new Set([
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PWD',
  'KEY',
  'APIKEY',
  'AUTH',
  'AUTHORIZATION',
  'CREDENTIAL',
  'CREDENTIALS',
  'PAT',
  'COOKIE',
  'PRIVATE',
  'DSN',
]);

/**
 * Endings that mark a credential inside a compound segment: `PGPASSWORD`, `ACCESSTOKEN`, and a
 * camelCase key such as `accessToken`, which is one segment once uppercased.
 */
const CREDENTIAL_SUFFIXES: readonly string[] = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'APIKEY',
  'ACCESSKEY',
  'PRIVATEKEY',
  'CONNECTIONSTRING',
];

/** Names that carry a credential without saying so: connection strings embed one. */
const CREDENTIAL_NAMES: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'MYSQL_URL',
  'REDIS_URL',
  'MONGODB_URI',
  'MONGODB_URL',
  'MONGO_URI',
  'MONGO_URL',
  'AMQP_URL',
  'RABBITMQ_URL',
]);

/** The shell's own directory variables, which a `PWD` segment would otherwise catch. */
const NOT_CREDENTIALS: ReadonlySet<string> = new Set(['PWD', 'OLDPWD']);

/** Whether a variable, env key or header name names a credential. Case-insensitive. */
export function isCredentialShapedName(name: string): boolean {
  const upper = name.toUpperCase();
  if (NOT_CREDENTIALS.has(upper)) return false;
  if (CREDENTIAL_NAMES.has(upper)) return true;
  const segments = upper.split(/[^A-Z0-9]+/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => CREDENTIAL_SEGMENTS.has(segment))) return true;
  if (segments.some((segment) => CREDENTIAL_SUFFIXES.some((end) => segment.endsWith(end)))) {
    return true;
  }
  return segments.join('_').endsWith('CONNECTION_STRING');
}

/** A secret expanded from a variable is shown as the variable it came from. */
export function secretMarker(variable: string): string {
  return `secret:${variable}`;
}

/** A value under a credential-shaped key, with no variable to name. */
export const SECRET_LITERAL = 'secret:literal';

function keyOf(field: string): string | undefined {
  const dot = field.indexOf('.');
  return dot === -1 ? undefined : field.slice(dot + 1);
}

/**
 * `value`, as it may be printed or fingerprinted: each secret stretch replaced by a marker naming
 * the variable it came from. Under a credential-shaped key every stretch is secret — literal text
 * becomes {@link SECRET_LITERAL} and each expanded stretch still names its variable, so pointing a
 * key at a different credential is a different value. `field` is the value's path in
 * {@link IMCPServerDefinitionResolved.provenance}.
 */
export function withoutSecrets(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): string {
  return secretPieces(definition, field, value)
    .map((piece) => piece.text)
    .join('');
}

/** One stretch of a value: printable text, or a marker standing for a secret. */
interface ISecretPiece {
  readonly text: string;
  readonly marker: boolean;
}

function secretPieces(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): readonly ISecretPiece[] {
  const key = keyOf(field);
  const wholeValueSecret = key !== undefined && isCredentialShapedName(key);
  // Forward, in (start, end) order: two stretches can start at the same offset when one is empty.
  const spans = [...(definition.provenance?.[field] ?? [])].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
  const pieces: ISecretPiece[] = [];
  let cursor = 0;
  const literal = (text: string): void => {
    if (text.length === 0) return;
    pieces.push(
      wholeValueSecret ? { text: SECRET_LITERAL, marker: true } : { text, marker: false },
    );
  };
  for (const span of spans) {
    literal(value.slice(cursor, span.start));
    if (span.secret || wholeValueSecret) {
      pieces.push({ text: secretMarker(span.variable), marker: true });
    } else {
      literal(value.slice(span.start, span.end));
    }
    cursor = span.end;
  }
  literal(value.slice(cursor));
  if (wholeValueSecret && pieces.length === 0) pieces.push({ text: SECRET_LITERAL, marker: true });
  return pieces;
}

// Display-only masking: literal credentials recognised by their shape.
//
// Everything below guesses, so it serves what is PRINTED — projections and the activation
// endpoint — and never the fingerprint: two different literal tokens mask alike, and a fingerprint
// blind to a changed token would let a swapped credential ride on an old approval.
//
// Every pattern here is either anchored by a lookbehind or starts only after a delimiter, so each
// position of the input starts at most one bounded scan: an argument of any length stays linear.

/** Holds a marker's place while the text around it is scanned; no pattern below matches it. */
const SENTINEL = '\uE000';
const SENTINELS = /\uE000/g;
const MARKER_TEXT = /secret:[A-Za-z_][A-Za-z0-9_]*/g;

/** Well-known credential formats. */
const CREDENTIAL_FORMATS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /gh[pos]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /glpat-[A-Za-z0-9_-]{16,}/,
  /xox[bpas]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
];
const FORMAT_SOURCE = CREDENTIAL_FORMATS.map((format) => format.source).join('|');
const FORMATTED_TOKEN = new RegExp(
  `(?<![A-Za-z0-9_.-])(?:${FORMAT_SOURCE})(?![A-Za-z0-9_.-])`,
  'g',
);
const WHOLE_FORMATTED_TOKEN = new RegExp(`^(?:${FORMAT_SOURCE})$`);
/** A base64/base64url/hex run; `/` is left out so no path segment chain reads as one. */
const ENCODED_RUN = /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_-]{32,}={0,2}(?![A-Za-z0-9+_=-])/g;
const BEARER = /\b(Bearer\s+)[^\s\uE000]+/gi;
const URL_RUN = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/g;
/** `Name: value` at the start of a word; the value runs to the end of the line. */
const HEADER_NAME = /(^|[\s;,"'])([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(?=\S)/g;
const AUTHORIZATION_HEADER = /^(?:proxy-)?authorization$/i;
/** `--name=value` or `NAME=value` at the start of a word or after `;`, `&` or `,`. */
const ASSIGNMENT = /(^|[\s;&,])(-{0,2})([A-Za-z_][A-Za-z0-9_.-]*)=([^\s;&,]+)/g;
/** `--name value` inside a single string. */
const SPACED_FLAG = /(^|\s)(-{1,2}[A-Za-z][A-Za-z0-9_.-]*)(\s+)([^\s-]\S*)/g;

function isHighEntropy(run: string): boolean {
  const body = run.replace(/=+$/, '');
  if (body.length < 32) return false;
  if (/^[0-9a-fA-F]+$/.test(body)) {
    // A commit SHA or a sha256 digest names content; it grants nothing.
    return !(/^[0-9a-f]+$/.test(body) && (body.length === 40 || body.length === 64));
  }
  // Random base64 of this length all but always mixes all three; a hyphenated name does not.
  return /[0-9]/.test(body) && /[a-z]/.test(body) && /[A-Z]/.test(body);
}

/**
 * Whether one token has the shape of a credential: a well-known credential format, a JWT, a
 * `Bearer` value, or a long high-entropy base64/hex run — but not a 40- or 64-character lowercase
 * hex string, which is a commit SHA or a digest. For display only.
 */
export function looksLikeCredential(token: string): boolean {
  const value = token.trim();
  if (/^Bearer\s+\S+$/i.test(value)) return true;
  if (WHOLE_FORMATTED_TOKEN.test(value)) return true;
  return /^[A-Za-z0-9+_-]+={0,2}$/.test(value) && isHighEntropy(value);
}

/**
 * Whether a name given a value (`NAME=value`, `--name value`) makes that value a credential. A name
 * ending in `file` or `path` takes the credential's location, which is shown.
 */
function takesCredential(name: string): boolean {
  return !/[-_.]?(?:file|path)$/i.test(name) && isCredentialShapedName(name);
}

/**
 * Whether a command-line flag takes a credential. A single-letter flag such as `-p` never does,
 * and neither does a negated `--no-…` flag, which takes no value at all.
 */
function isCredentialFlag(word: string): boolean {
  const match = /^-{1,2}([A-Za-z][A-Za-z0-9_.-]*)$/.exec(word);
  if (match === null) return false;
  const name = match[1]!;
  return name.length > 1 && !/^no-/i.test(name) && takesCredential(name);
}

/** A secret value as displayed: its literal text masked, any marker inside it kept. */
function maskLiteral(value: string): string {
  return value.replace(/[^\uE000]+/g, SECRET_LITERAL);
}

function decodedName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name; // A malformed escape is judged as written.
  }
}

/** `name=value` pairs joined by `&`, as in a query or a fragment, credential-named values masked. */
function maskParams(params: string): string {
  return params
    .split('&')
    .map((param) => {
      const equals = param.indexOf('=');
      if (equals <= 0 || equals === param.length - 1) return param;
      const name = param.slice(0, equals);
      return isCredentialShapedName(decodedName(name).replace(SENTINELS, ''))
        ? `${name}=${maskLiteral(param.slice(equals + 1))}`
        : param;
    })
    .join('&');
}

function maskUrl(url: string): string {
  // Userinfo ends at the LAST `@` of the authority and the password starts after its first `:`,
  // as a WHATWG parser reads it, so an `@` inside the password cannot leave a tail behind.
  const withUser = url.replace(
    /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#\s]*)@/,
    (whole, scheme: string, userinfo: string) => {
      const colon = userinfo.indexOf(':');
      if (colon === -1) return whole;
      return `${scheme}${userinfo.slice(0, colon)}:${maskLiteral(userinfo.slice(colon + 1))}@`;
    },
  );
  const hash = withUser.indexOf('#');
  const beforeHash = hash === -1 ? withUser : withUser.slice(0, hash);
  const fragment = hash === -1 ? '' : `#${maskParams(withUser.slice(hash + 1))}`;
  const query = beforeHash.indexOf('?');
  if (query === -1) return `${beforeHash}${fragment}`;
  return `${beforeHash.slice(0, query + 1)}${maskParams(beforeHash.slice(query + 1))}${fragment}`;
}

/** An `Authorization` value keeps its scheme (`Basic`, `Token`, …) and masks the credential. */
function maskAuthorization(value: string): string {
  const scheme = /^([A-Za-z][A-Za-z0-9._~+-]*)([ \t]+)(?=\S)/.exec(value);
  if (scheme === null) return maskLiteral(value);
  return `${scheme[0]}${maskLiteral(value.slice(scheme[0].length))}`;
}

/** `Name: value` with a credential-shaped name: the value masked to the end of its line. */
function maskHeaders(text: string): string {
  HEADER_NAME.lastIndex = 0;
  let out = '';
  let cursor = 0;
  for (let match = HEADER_NAME.exec(text); match !== null; match = HEADER_NAME.exec(text)) {
    const name = match[2]!;
    if (!isCredentialShapedName(name)) continue;
    const valueStart = match.index + match[0].length;
    const newline = text.indexOf('\n', valueStart);
    const valueEnd = newline === -1 ? text.length : newline;
    const value = text.slice(valueStart, valueEnd);
    out += text.slice(cursor, valueStart);
    out += AUTHORIZATION_HEADER.test(name) ? maskAuthorization(value) : maskLiteral(value);
    cursor = valueEnd;
    HEADER_NAME.lastIndex = valueEnd;
  }
  return out + text.slice(cursor);
}

function maskScanned(text: string): string {
  return maskHeaders(text.replace(URL_RUN, maskUrl))
    .replace(ASSIGNMENT, (whole, lead: string, dashes: string, name: string, value: string) => {
      const credential =
        dashes.length > 0 ? isCredentialFlag(`${dashes}${name}`) : takesCredential(name);
      return credential ? `${lead}${dashes}${name}=${maskLiteral(value)}` : whole;
    })
    .replace(SPACED_FLAG, (whole, lead: string, flag: string, gap: string, value: string) =>
      isCredentialFlag(flag) ? `${lead}${flag}${gap}${maskLiteral(value)}` : whole,
    )
    .replace(BEARER, (_whole, bearer: string) => `${bearer}${SECRET_LITERAL}`)
    .replace(FORMATTED_TOKEN, SECRET_LITERAL)
    .replace(ENCODED_RUN, (run) => (isHighEntropy(run) ? SECRET_LITERAL : run));
}

function restoreMarkers(text: string, markers: readonly string[]): string {
  let index = 0;
  return text.replace(SENTINELS, () => markers[index++] ?? '');
}

/** Text with each marker swapped for a sentinel, so no marker is read as literal text. */
interface IScanned {
  readonly scanned: string;
  readonly markers: readonly string[];
}

function scanPieces(pieces: readonly ISecretPiece[]): IScanned {
  const markers: string[] = [];
  const scanned = pieces
    .map((piece) => {
      if (!piece.marker) return piece.text.replace(SENTINELS, '\uFFFD');
      markers.push(piece.text);
      return SENTINEL;
    })
    .join('');
  return { scanned, markers };
}

/**
 * Free text with every credential-shaped literal replaced by {@link SECRET_LITERAL}: a URL's
 * password and credential-named query or fragment values, a credential-named header, flag or
 * assignment value, an `Authorization` credential after its scheme, and every token
 * {@link looksLikeCredential} would flag. Markers already in the text are kept. Deterministic, so
 * two printings of one value compare equal. For display only.
 */
export function maskCredentials(text: string): string {
  const safe = text.replace(SENTINELS, '\uFFFD');
  const markers = safe.match(MARKER_TEXT) ?? [];
  return restoreMarkers(maskScanned(safe.replace(MARKER_TEXT, SENTINEL)), markers);
}

/** A definition value as it may be printed: {@link withoutSecrets}, then {@link maskCredentials}. */
export function displayValue(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  field: string,
  value: string,
): string {
  const { scanned, markers } = scanPieces(secretPieces(definition, field, value));
  return restoreMarkers(maskScanned(scanned), markers);
}

/**
 * Command arguments as they may be printed: each through {@link displayValue}, and the argument
 * after a credential-named flag (`--token x`) masked whole, since only its position says what it is.
 */
export function displayArgs(
  definition: Pick<IMCPServerDefinitionResolved, 'provenance'>,
  args: readonly string[],
): readonly string[] {
  return args.map((arg, index) => {
    const field = `args[${index}]`;
    const previous = index > 0 ? args[index - 1] : undefined;
    if (previous !== undefined && isCredentialFlag(previous) && !/^-{1,2}[A-Za-z]/.test(arg)) {
      const { scanned, markers } = scanPieces(secretPieces(definition, field, arg));
      return restoreMarkers(maskLiteral(scanned), markers);
    }
    return displayValue(definition, field, arg);
  });
}

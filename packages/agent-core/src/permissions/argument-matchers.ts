/**
 * The per-kind argument matchers the permission gate dispatches to (CORE-049, issue #2350).
 *
 * Kept beside the gate rather than inside it: the gate owns WHEN a pattern is consulted (deny,
 * unevaluable, allow, mode policy); this module owns HOW one pattern is compared with one argument
 * of a declared kind. Nothing here reads the profile registry or the mode.
 */
import path from 'node:path';
import { domainToASCII } from 'node:url';

/**
 * What kind of thing a tool's primary argument is — which decides how a pattern is matched against
 * it. CORE-049 (issue #2350): one glob served every kind, so `WebFetch(https://*.example.com/**)`
 * was a wildcard over the whole URL string — query, fragment, userinfo and path included — and
 * `Read(/src/*)` crossed `/`. Each kind has its own delimiter and its own canonical form:
 *
 * - `url`     — the pattern is split by a grammar (scheme, host, port, path) and the ARGUMENT is
 *               parsed with `new URL`, so alternate host encodings canonicalise before comparison;
 *               query and fragment never participate; only special schemes are comparable.
 * - `path`    — separators normalised, both sides lexically normalised; `*` stays inside one
 *               segment, `**` crosses.
 * - `command` — today's shell-style glob (`*` any run of characters). The separator residual
 *               (`Bash(git *)` matching `git status; rm -rf /`) is issue #2427.
 * - `text`    — today's glob, for arguments that are neither (a search query, a glob pattern).
 *
 * A bare `*` or `**` argument pattern matches ANY invocation of the tool, for every kind and for a
 * tool that declared no argument at all — the contract `toolNamesToPatterns` (preset
 * `allowedTools`/`deniedTools` → `Tool(*)`) relies on.
 */
export type TArgumentKind = 'path' | 'url' | 'command' | 'text';

/**
 * One match is three answers, not two. A pattern or argument the matcher cannot interpret in the
 * declared kind is UNEVALUABLE — `url`: the argument does not parse, carries userinfo, has no host
 * or a non-special scheme, or a path segment does not percent-decode; the pattern does not fit the
 * grammar, or its literal host does not parse; `path`: a relative argument under an absolute
 * pattern. An unevaluable deny is not "not denied" (CORE-030: "I cannot tell" is not "no"):
 * `hasUnevaluableArgumentPattern` reports it and the gate prompts instead of falling through to the
 * allow list and the mode policy, which for an `inspect` tool is `auto` in every mode.
 */
export type TPatternMatch = 'match' | 'no-match' | 'unevaluable';

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g;

/**
 * Convert a glob-style wildcard pattern to a RegExp — the `command` and `text` matcher.
 * Only `*` and `**` wildcards are supported (same semantics as minimatch lite).
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(REGEX_SPECIALS, '\\$&') // escape regex specials except * ?
    .replace(/\*\*/g, '.+') // ** → one-or-more any char
    .replace(/\*/g, '.*'); // * → zero-or-more any char (shell-style, not path-segment restricted)
  return new RegExp(`^${escaped}$`);
}

/**
 * A segment glob: `*` never crosses `/`; `**` does, gitignore-style — `a/**` also matches `a`,
 * `a/**\/b` also matches `a/b` (zero or more directories), and a bare `**` matches anything.
 */
function segmentGlobToRegex(glob: string): RegExp {
  // Tokenise so the two wildcards never collide: `**` crosses segments, `*` stays inside one.
  const body = glob
    .split(/(\/\*\*\/|\/\*\*$|^\*\*\/|\*\*)/)
    .map((token) => {
      if (token === '/**/') return '(?:/.*)?/';
      if (token === '/**') return '(?:/.*)?';
      if (token === '**/') return '(?:.*/)?';
      if (token === '**') return '.*';
      return token.replace(REGEX_SPECIALS, '\\$&').replace(/\*/g, '[^/]*');
    })
    .join('');
  return new RegExp(`^${body}$`);
}

/** `/…` on every platform; `X:/…` is absolute too, so a Windows argument is judged, not dropped. */
function isAbsolutePathLike(normalised: string): boolean {
  return normalised.startsWith('/') || /^[A-Za-z]:\//.test(normalised);
}

/** `\` → `/`, `.`/`..` collapsed, a drive letter lower-cased (case-insensitive filesystems). */
function normalisePathText(text: string): string {
  const slashed = text.replace(/\\/g, '/');
  const normalised = path.posix.normalize(slashed);
  return normalised.replace(/^[A-Za-z]:\//, (drive) => drive.toLowerCase());
}

/** The `path` matcher: separators and `.`/`..` normalised lexically; a relative argument under an absolute pattern is unevaluable. */
export function matchPath(pattern: string, argument: string): TPatternMatch {
  const normalisedPattern = normalisePathText(pattern);
  const normalisedArgument = normalisePathText(argument);
  if (isAbsolutePathLike(normalisedPattern) && !isAbsolutePathLike(normalisedArgument)) {
    // No base to resolve the argument against (issue #2429 owns where that happens). Not "no".
    return 'unevaluable';
  }
  return segmentGlobToRegex(normalisedPattern).test(normalisedArgument) ? 'match' : 'no-match';
}

/**
 * The grammar a `url` PATTERN must fit: `scheme://host[:port][/path]` — scheme a literal or `*`;
 * host a bracketed IPv6 literal or labels carrying `*`/`**` (never `@`, `:`, `/`, `?`, `#`); port a
 * number or `*`; path optional. Userinfo, query and fragment do not fit: such a pattern is not a
 * host pattern and is refused as unevaluable rather than guessed at.
 */
const URL_PATTERN_GRAMMAR =
  /^(\*|[a-z][a-z0-9+.-]*):\/\/(\[[0-9a-fA-F:.]+\]|[^/:?#@[\]]+)(?::(\d+|\*))?(\/[^?#]*)?$/i;

/** The schemes whose host `new URL` canonicalises; any other scheme keeps its host opaque. */
const SPECIAL_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'ws', 'wss', 'ftp']);
const DEFAULT_PORT: Readonly<Record<string, string>> = {
  http: '80',
  https: '443',
  ws: '80',
  wss: '443',
  ftp: '21',
};

/** Both sides drop one trailing dot and lower-case; `new URL` does neither for the trailing dot. */
function canonicalHostText(host: string): string {
  return host.replace(/\.$/, '').toLowerCase();
}

/**
 * A wildcard host pattern as a RegExp over the argument's canonical hostname. `*` as a whole
 * label = one or more labels; `**` as a whole label = zero or more (so `**.example.com` covers the
 * apex); `*` inside a label = within that label; `*` as the entire host = any host. Literal labels
 * pass `domainToASCII` so an IDN pattern meets the argument's punycode form. `a**b` inside a label
 * is not a rule this grammar states and yields null (unevaluable).
 */
function hostPatternToRegex(hostPattern: string): RegExp | null {
  const labels = canonicalHostText(hostPattern).split('.');
  const parts: string[] = [];
  const LABELS = '[^.]+(?:\\.[^.]+)*'; // one or more dot-separated labels
  for (const [index, label] of labels.entries()) {
    const first = index === 0;
    const last = index === labels.length - 1;
    // Dots between labels are LITERAL — `*.example.com` must not match `evilexample.com`. Only a
    // `**` label, which may stand for zero labels, absorbs the dot beside it.
    if (label === '**') {
      if (first && last) parts.push(LABELS);
      else if (last) parts.push(`(?:\\.${LABELS})?`);
      else parts.push(`${first ? '' : '\\.'}(?:${LABELS}\\.)?`);
      continue;
    }
    const previousWasAnyLabels = !first && labels[index - 1] === '**';
    const dot = first || previousWasAnyLabels ? '' : '\\.';
    if (label === '*') parts.push(`${dot}${LABELS}`);
    else if (label.includes('**')) return null;
    else if (label.includes('*')) {
      parts.push(`${dot}${label.replace(REGEX_SPECIALS, '\\$&').replace(/\*/g, '[^.]*')}`);
    } else {
      const ascii = domainToASCII(label);
      if (ascii === '') return null;
      parts.push(`${dot}${ascii.replace(REGEX_SPECIALS, '\\$&')}`);
    }
  }
  return new RegExp(`^${parts.join('')}$`);
}

/**
 * A percent-decoded pathname, segment by segment; null when a segment does not decode or decodes
 * to something containing `/` (`%2F`) — such a segment is neither a separator nor a name a pattern
 * segment could equal, so it is reported as unevaluable rather than guessed at.
 */
function decodedSegments(pathname: string): string | null {
  try {
    const segments = pathname.split('/').map((segment) => decodeURIComponent(segment));
    if (segments.some((segment) => segment.includes('/'))) return null;
    return segments.join('/');
  } catch {
    // allow-fallback: a segment that does not percent-decode is reported by the caller as
    // UNEVALUABLE (a prompt on the deny side), never as a match or a silent non-match.
    return null;
  }
}

/** The `url` matcher: the pattern by grammar, the argument by `new URL`, compared structurally. */
export function matchUrl(pattern: string, argument: string): TPatternMatch {
  const grammar = URL_PATTERN_GRAMMAR.exec(pattern);
  if (grammar === null) return 'unevaluable';
  const [, schemePattern, hostPattern, portPattern, pathPattern] = grammar;

  let url: URL;
  try {
    url = new URL(argument);
  } catch {
    return 'unevaluable';
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!SPECIAL_SCHEMES.has(scheme)) return 'unevaluable'; // `file:`, `foo:`: host opaque or absent
  if (url.hostname === '') return 'unevaluable';
  if (url.username !== '' || url.password !== '') return 'unevaluable';

  if (schemePattern !== '*' && schemePattern.toLowerCase() !== scheme) return 'no-match';

  const host = canonicalHostText(url.hostname);
  if (hostPattern.includes('*')) {
    const regex = hostPatternToRegex(hostPattern);
    if (regex === null) return 'unevaluable';
    if (!regex.test(host)) return 'no-match';
  } else {
    // A literal pattern host is canonicalised the way the argument's was — by a special scheme,
    // whatever the pattern's scheme (including `*`).
    let literal: string;
    try {
      literal = new URL(`http://${hostPattern}/`).hostname;
    } catch {
      return 'unevaluable';
    }
    if (canonicalHostText(literal) !== host) return 'no-match';
  }

  if (portPattern === undefined) {
    if (url.port !== '') return 'no-match'; // no port in the pattern: the scheme default only
  } else if (portPattern !== '*') {
    const port = url.port === '' ? DEFAULT_PORT[scheme] : url.port;
    if (portPattern !== port) return 'no-match';
  }

  if (pathPattern !== undefined) {
    const decoded = decodedSegments(url.pathname);
    const decodedPattern = decodedSegments(pathPattern);
    if (decoded === null || decodedPattern === null) return 'unevaluable';
    if (!segmentGlobToRegex(decodedPattern).test(decoded)) return 'no-match';
  }
  return 'match';
}

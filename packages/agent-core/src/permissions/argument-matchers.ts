/**
 * The per-kind argument matchers the permission gate dispatches to (CORE-049, issue #2350).
 *
 * Kept beside the gate rather than inside it: the gate owns WHEN a pattern is consulted (deny,
 * unevaluable, allow, mode policy); this module owns HOW one pattern is compared with one argument
 * of a declared kind. Nothing here reads the profile registry or the mode — and nothing here
 * imports a Node builtin: `agent-core` ships a browser bundle (CORE-028), so path normalisation is
 * lexical and IDN mapping goes through the WHATWG `URL` the platform provides.
 */
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
 * - `command` — a shell-style glob (`*` any run of characters) over ONE command: on the ALLOW side
 *               an argument that carries a separator (`;` `&` `|` newline) or a substitution (`$(`
 *               backtick `<(` `>(`) outside single quotes is not a command the pattern names
 *               (issue #2427); on the DENY side the same line is cut at those boundaries and every
 *               command it runs is judged, so a chained command cannot walk past a deny entry.
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
 * or a non-special scheme, or a path segment does not percent-decode or decodes to a separator
 * (`%2F`); the pattern does not fit the grammar, its literal host does not parse, or a segment of
 * its path does not decode; `path`: a relative argument under an absolute pattern. An unevaluable deny is not "not denied" (CORE-030: "I cannot tell" is not "no"):
 * `hasUnevaluableArgumentPattern` reports it and the gate prompts instead of falling through to the
 * allow list and the mode policy, which for an `inspect` tool is `auto` in every mode.
 */
export type TPatternMatch = 'match' | 'no-match' | 'unevaluable';

/**
 * Which LIST the pattern being evaluated came from — because for the `command` kind the two lists
 * are not mirror images of each other, and treating them as one is a permission bypass.
 *
 * An allow pattern answers "is THIS the command I blessed?", so a line carrying a second command is
 * not it (issue #2427). A deny pattern answers "does this line RUN the command I forbade?", and
 * there the same rule reads "not denied": `deny: ['Bash(rm *)']` stopped matching
 * `rm -rf / ; echo done`, which then fell through to `allow: ['Bash']` or to the mode policy and
 * was auto-approved. Appending `; echo done` to walk past a deny entry is precisely what a deny
 * list exists to stop, so the deny direction looks INSIDE the line instead of refusing to judge it.
 *
 * Every other kind (`path`, `url`, `text`) matches identically in both directions and ignores this.
 */
export type TMatchDirection = 'allow' | 'deny';

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g;

/**
 * Convert a glob-style wildcard pattern to a RegExp — the `text` matcher, and the first half of
 * the `command` one.
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
 * Does the command line carry a second command? A separator (`;`, `&`, `&&`, `|`, `||`, newline)
 * outside quotes, or a substitution (`$(`, backtick, `<(`, `>(`) outside SINGLE quotes — double
 * quotes do not stop the shell from running what is inside `"$(…)"`. A backslash outside single
 * quotes escapes the next character. `Bash(git *)` then does not match `git status; rm -rf /`.
 *
 * The anti-goal (issue #2427): refusal comes from RECOGNISING a separator, not from escaping more
 * characters in the glob — `*` in a pattern still stands for any run of characters, so the
 * pattern's author keeps writing `git *` and the gate keeps `git commit -m "a; b"` matchable.
 */
function hasUnquotedCommandSeparator(command: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }
    const next = command[index + 1];
    if (char === '`' || (char === '$' && next === '(')) return true;
    if (quote === '"') {
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n') return true;
    if ((char === '<' || char === '>') && next === '(') return true;
    // `2>&1`, `<&0` and `&>log` are redirections, not a second command.
    if (char === '&') {
      const previous = command[index - 1];
      if (previous !== '>' && previous !== '<' && next !== '>') return true;
    }
  }
  return false;
}

/**
 * Cut a command line into the individual commands it runs: at every unquoted separator, and at
 * every substitution boundary — `$(…)`, `` `…` ``, `<(…)`, `>(…)` — whose contents are a command of
 * their own even inside double quotes. The quoting rules are `hasUnquotedCommandSeparator`'s, so
 * the two functions agree on what a separator IS; a separator the shell would treat as literal text
 * (single- or double-quoted, or backslash-escaped) does not cut, and a redirection (`2>&1`, `&>log`)
 * is not a cut either.
 *
 * Segment text is kept RAW (quotes included, ends trimmed): the pattern glob is written against the
 * command line as the caller wrote it, so unquoting here would change what `Bash(rm *)` compares
 * with. Empty segments are dropped.
 */
function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  let substitutionDepth = 0;
  const cut = (): void => {
    const trimmed = current.trim();
    if (trimmed !== '') segments.push(trimmed);
    current = '';
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote === "'") {
      current += char;
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === '\\') {
      const escaped = command[index + 1];
      current += escaped === undefined ? char : char + escaped;
      index += 1;
      continue;
    }
    const next = command[index + 1];
    // A substitution runs its contents whatever quoting surrounds it — `"$(…)"` included.
    if (char === '`') {
      cut();
      continue;
    }
    if (char === '$' && next === '(') {
      cut();
      substitutionDepth += 1;
      index += 1;
      continue;
    }
    if (quote === '"') {
      current += char;
      if (char === '"') quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if ((char === '<' || char === '>') && next === '(') {
      cut();
      substitutionDepth += 1;
      index += 1;
      continue;
    }
    if (char === ')' && substitutionDepth > 0) {
      cut();
      substitutionDepth -= 1;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n') {
      cut();
      continue;
    }
    if (char === '&') {
      const previous = command[index - 1];
      // `2>&1`, `<&0` and `&>log` are redirections, not a second command.
      if (previous !== '>' && previous !== '<' && next !== '>') {
        cut();
        continue;
      }
    }
    current += char;
  }
  cut();
  return segments;
}

/**
 * The `command` matcher. The glob decides whether the pattern names this command; what a separator
 * or substitution outside quotes MEANS depends on which list the pattern came from
 * ({@link TMatchDirection}).
 *
 * ALLOW (issue #2427): a line carrying a second command is not the one command the pattern named,
 * so it is `no-match` and the invocation goes on to be judged by the mode. A pattern without a
 * wildcard is the exact line and matches it — an operator who allowed `git status && git push`
 * verbatim wrote the whole line, and only the whole line is allowed.
 *
 * DENY: refusing to judge a chained line would answer "not denied", which auto-approves it. So the
 * glob is tried against the whole line AND against each command the line runs: `deny: ['Bash(rm *)']`
 * catches `rm -rf / ; echo done`, `git status; rm -rf /` and `echo $(rm -rf /tmp/x)` alike. Quoting
 * is still honoured, so `echo "rm -rf /"` — which runs no `rm` — is not denied.
 */
export function matchCommand(
  pattern: string,
  argument: string,
  direction: TMatchDirection,
): TPatternMatch {
  const regex = globToRegex(pattern);
  if (direction === 'deny') {
    if (regex.test(argument)) return 'match';
    return splitCommandSegments(argument).some((segment) => regex.test(segment))
      ? 'match'
      : 'no-match';
  }
  if (!regex.test(argument)) return 'no-match';
  if (!pattern.includes('*')) return 'match';
  return hasUnquotedCommandSeparator(argument) ? 'no-match' : 'match';
}

/**
 * A segment glob: `*` never crosses `/`; `**` does, gitignore-style — `a/**` also matches `a`,
 * `a/**\/b` also matches `a/b` (zero or more directories), and a bare `**` matches anything.
 */
function segmentGlobToRegex(glob: string): RegExp {
  // Adjacent `**` mean what one means (gitignore: `a/**/**/b` is `a/**/b`); then tokenise so the
  // two wildcards never collide — `**` crosses segments, `*` stays inside one. A `\uE000` mark is a
  // literal `*` that percent-decoding produced (`%2A`): it must not become a wildcard.
  const body = glob
    .replace(/\*\*(?:\/\*\*)+/g, '**')
    .split(/(\/\*\*\/|\/\*\*$|^\*\*\/|\*\*)/)
    .map((token) => {
      if (token === '/**/') return '(?:/.*)?/';
      if (token === '/**') return '(?:/.*)?';
      if (token === '**/') return '(?:.*/)?';
      if (token === '**') return '.*';
      return token
        .replace(REGEX_SPECIALS, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\uE000/g, '\\*');
    })
    .join('');
  return new RegExp(`^${body}$`);
}

/** `/…` on every platform; `X:/…` is absolute too, so a Windows argument is judged, not dropped. */
function isAbsolutePathLike(normalised: string): boolean {
  return normalised.startsWith('/') || /^[A-Za-z]:(?=\/|$)/.test(normalised);
}

/**
 * `\` → `/`, `.`/`..` collapsed lexically (no filesystem access, no Node builtin), a drive letter
 * lower-cased (case-insensitive filesystems). A leading `..` on an absolute path stays at the root,
 * as `path.posix.normalize` does; on a relative path it is kept, so `../x` remains `../x`.
 */
function normalisePathText(text: string): string {
  const slashed = text.replace(/\\/g, '/');
  const absolute = slashed.startsWith('/');
  const out: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(segment);
  }
  const joined = (absolute ? '/' : '') + out.join('/');
  const normalised = joined === '' ? '.' : joined;
  return normalised.replace(/^[A-Za-z]:(?=\/|$)/, (drive) => drive.toLowerCase());
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
  /^(\*|[a-z][a-z0-9+.-]*):\/\/(\[[0-9a-fA-F:.]+\]|[^/\\:?#@[\]]+)(?::(\d+|\*))?(\/[^?#]*)?$/i;

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

/** A single host label in its ASCII (punycode) form via the platform URL parser; null when invalid. */
function labelToASCII(label: string): string | null {
  try {
    const host = new URL(`http://${label}/`).hostname;
    return host === '' || host.includes('.') ? null : host;
  } catch {
    // allow-fallback: a label the URL parser refuses is reported as an unevaluable pattern by the
    // caller (a prompt on the deny side), never as a match or a silent non-match.
    return null;
  }
}

/**
 * A wildcard host pattern as a RegExp over the argument's canonical hostname. `*` as a whole
 * label = one or more labels; `**` as a whole label = zero or more (so `**.example.com` covers the
 * apex); `*` inside a label = within that label; `*` as the entire host = any host. Literal labels
 * are mapped to their ASCII (punycode) form by the platform URL parser, so an IDN pattern meets the
 * argument's punycode form; a label the parser refuses or splits makes the pattern unevaluable. `a**b` inside a label
 * is not a rule this grammar states and yields null (unevaluable).
 */
function hostPatternToRegex(hostPattern: string): RegExp | null {
  // Adjacent `**` labels mean what one means.
  const labels = canonicalHostText(hostPattern)
    .replace(/\*\*(?:\.\*\*)+/g, '**')
    .split('.');
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
      const ascii = labelToASCII(label);
      if (ascii === null) return null;
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

/** The argument as a `URL` whose host can be compared; null when it cannot be. */
function parseComparableUrl(argument: string): URL | null {
  let url: URL;
  try {
    url = new URL(argument);
  } catch {
    // allow-fallback: an argument that does not parse is reported by the caller as UNEVALUABLE.
    return null;
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!SPECIAL_SCHEMES.has(scheme)) return null; // `file:`, `foo:`: host opaque or absent
  if (url.hostname === '') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}

/** The host clause: a wildcard pattern by regex, a literal one canonicalised like the argument. */
function matchHost(hostPattern: string, host: string): TPatternMatch {
  if (hostPattern.includes('*')) {
    const regex = hostPatternToRegex(hostPattern);
    if (regex === null) return 'unevaluable';
    return regex.test(host) ? 'match' : 'no-match';
  }
  // A literal pattern host is canonicalised the way the argument's was — by a special scheme,
  // whatever the pattern's scheme (including `*`).
  let literal: string;
  try {
    literal = new URL(`http://${hostPattern}/`).hostname;
  } catch {
    // allow-fallback: a literal host the parser refuses is reported as UNEVALUABLE, never matched.
    return 'unevaluable';
  }
  return canonicalHostText(literal) === host ? 'match' : 'no-match';
}

/** The port clause: absent means the scheme default only; `*` means any; else the exact port. */
function matchPort(portPattern: string | undefined, url: URL, scheme: string): boolean {
  if (portPattern === undefined) return url.port === '';
  if (portPattern === '*') return true;
  const port = url.port === '' ? DEFAULT_PORT[scheme] : url.port;
  return portPattern === port;
}

/** The path clause: both sides percent-decoded segment by segment, then a segment glob. */
function matchPathname(pathPattern: string, pathname: string): TPatternMatch {
  const decoded = decodedSegments(pathname);
  // A percent-encoded `*` in the PATTERN is a literal star, not a wildcard: mark it before decoding.
  const decodedPattern = decodedSegments(pathPattern.replace(/%2a/gi, '\uE000'));
  if (decoded === null || decodedPattern === null) return 'unevaluable';
  return segmentGlobToRegex(decodedPattern).test(decoded) ? 'match' : 'no-match';
}

/** The `url` matcher: the pattern by grammar, the argument by `new URL`, compared structurally. */
export function matchUrl(pattern: string, argument: string): TPatternMatch {
  const grammar = URL_PATTERN_GRAMMAR.exec(pattern);
  if (grammar === null) return 'unevaluable';
  const [, schemePattern, hostPattern, portPattern, pathPattern] = grammar;

  const url = parseComparableUrl(argument);
  if (url === null) return 'unevaluable';
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (schemePattern !== '*' && schemePattern.toLowerCase() !== scheme) return 'no-match';

  const host = matchHost(hostPattern, canonicalHostText(url.hostname));
  if (host !== 'match') return host;
  if (!matchPort(portPattern, url, scheme)) return 'no-match';
  if (pathPattern !== undefined) return matchPathname(pathPattern, url.pathname);
  return 'match';
}

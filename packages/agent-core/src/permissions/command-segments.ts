/**
 * Shell-line segmentation for the `command` argument matcher (issue #2427).
 *
 * Split out of `argument-matchers.ts`, which owns HOW a pattern of a declared kind is compared with
 * an argument; this module owns the one question underneath the `command` kind — where a shell line
 * stops being ONE command. Two answers over the same quoting rules: whether a line carries a second
 * command at all ({@link hasUnquotedCommandSeparator}, the ALLOW direction's refusal), and what the
 * individual commands are ({@link splitCommandSegments}, which the DENY direction judges one by
 * one). Keeping both here is what keeps them agreeing on what a separator IS.
 *
 * No Node builtin: `agent-core` ships a browser bundle (CORE-028), and this is pure string work.
 */

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
export function hasUnquotedCommandSeparator(command: string): boolean {
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
export function splitCommandSegments(command: string): string[] {
  const scan: IScanState = { segments: [], current: '', quote: undefined, substitutionDepth: 0 };
  for (let index = 0; index < command.length; index += 1) {
    // The order below IS the rule: single-quoted text and backslash escapes are literal first, a
    // substitution runs whatever quoting surrounds it next, double quotes only then suppress the
    // remaining separators. `hasUnquotedCommandSeparator` asks the same questions in the same order.
    const literal = consumeLiteralText(scan, command, index);
    if (literal !== undefined) {
      index = literal;
      continue;
    }
    const substitution = consumeSubstitutionOpen(scan, command, index);
    if (substitution !== undefined) {
      index = substitution;
      continue;
    }
    if (consumeQuote(scan, command[index]!)) continue;
    const separator = consumeSeparator(scan, command, index);
    if (separator !== undefined) {
      index = separator;
      continue;
    }
    scan.current += command[index]!;
  }
  cut(scan);
  return scan.segments;
}

/** The scanner's whole state: what has been cut off, what is being accumulated, and where it is. */
interface IScanState {
  segments: string[];
  current: string;
  quote: "'" | '"' | undefined;
  substitutionDepth: number;
}

/** End the segment under construction. An empty one is dropped, so `a ;; b` is two commands. */
function cut(scan: IScanState): void {
  const trimmed = scan.current.trim();
  if (trimmed !== '') scan.segments.push(trimmed);
  scan.current = '';
}

/**
 * Text that cannot be a boundary whatever follows: the body of a single-quoted run, and a
 * backslash with the character it escapes (which the shell honours inside double quotes too).
 * Returns the last index consumed, or `undefined` when this character is not literal text.
 */
function consumeLiteralText(scan: IScanState, command: string, index: number): number | undefined {
  const char = command[index]!;
  if (scan.quote === "'") {
    scan.current += char;
    if (char === "'") scan.quote = undefined;
    return index;
  }
  if (char === '\\') {
    const escaped = command[index + 1];
    scan.current += escaped === undefined ? char : char + escaped;
    return index + 1;
  }
  return undefined;
}

/**
 * A substitution runs its contents whatever quoting surrounds it — `"$(…)"` included — so it cuts
 * before the double-quote rule is consulted. Returns the last index consumed, else `undefined`.
 */
function consumeSubstitutionOpen(
  scan: IScanState,
  command: string,
  index: number,
): number | undefined {
  const char = command[index]!;
  if (char === '`') {
    cut(scan);
    return index;
  }
  if (char === '$' && command[index + 1] === '(') {
    cut(scan);
    scan.substitutionDepth += 1;
    return index + 1;
  }
  return undefined;
}

/** Enter or leave a quoted run, keeping the quote character in the segment text. */
function consumeQuote(scan: IScanState, char: string): boolean {
  if (scan.quote === '"') {
    scan.current += char;
    if (char === '"') scan.quote = undefined;
    return true;
  }
  if (char === "'" || char === '"') {
    scan.quote = char;
    scan.current += char;
    return true;
  }
  return false;
}

/**
 * The boundaries that only apply outside quotes: process substitution (`<(`, `>(`), the `)` that
 * closes one, and the plain separators `;` `|` `&` and newline. Returns the last index consumed,
 * else `undefined`.
 */
function consumeSeparator(scan: IScanState, command: string, index: number): number | undefined {
  const char = command[index]!;
  if ((char === '<' || char === '>') && command[index + 1] === '(') {
    cut(scan);
    scan.substitutionDepth += 1;
    return index + 1;
  }
  if (char === ')' && scan.substitutionDepth > 0) {
    cut(scan);
    scan.substitutionDepth -= 1;
    return index;
  }
  if (char === ';' || char === '|' || char === '\n') {
    cut(scan);
    return index;
  }
  if (char === '&' && startsASecondCommand(command, index)) {
    cut(scan);
    return index;
  }
  return undefined;
}

/** `2>&1`, `<&0` and `&>log` are redirections, not a second command. */
function startsASecondCommand(command: string, index: number): boolean {
  const previous = command[index - 1];
  return previous !== '>' && previous !== '<' && command[index + 1] !== '>';
}

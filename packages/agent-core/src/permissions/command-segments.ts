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

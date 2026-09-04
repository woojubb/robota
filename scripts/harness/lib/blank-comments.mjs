/**
 * Offset-preserving comment blanking — the single owner (issue #2258).
 *
 * A scan that regex-matches raw source cannot tell code from a comment: a comment that MENTIONS
 * `hookResult.blocked` vouched for a deleted guard, a commented-out policy row overrode the real
 * one, a stray `}` in a comment defeated brace-walking, and a commented-out call became a phantom
 * fire site — four permissive effects from one root, measured on `scan-hook-enforcement-reachable`.
 * The repository's older `stripComments` COLLAPSED block comments to one space, so it could not be
 * used where offsets matter; this replaces every comment byte with a space and keeps newlines, so
 * `lineOffsets`, brace walks and `indexOf` positions all stay valid, and `stripComments` now
 * delegates here rather than keeping a second implementation.
 */

/**
 * Is the `/` at `index` the start of a regex literal rather than division?
 *
 * The classic ambiguity, resolved the standard way: a regex may begin only where a VALUE may begin.
 * After an identifier, a number, a string, `)` or `]`, a `/` is division. A heuristic, not a parser.
 *
 * Its failure direction is PERMISSIVE, and that is stated here rather than in the caller because an
 * earlier revision claimed the opposite. The regex branch in `blankComments` only advances the
 * cursor — it never blanks — so a `/` that is really division, taken for a regex, causes the span to
 * the next `/` to be SKIPPED. A `//` inside that span then never starts a comment, and the comment
 * survives as code. See the limitation list on `blankComments`; contained under #2258.
 */
function startsRegexLiteral(source, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  const prev = source[j];
  if (/[A-Za-z0-9_$)\]]/.test(prev)) {
    // ...unless the identifier is a keyword that can precede a value.
    let k = j;
    while (k >= 0 && /[A-Za-z]/.test(source[k])) k -= 1;
    const word = source.slice(k + 1, j + 1);
    return ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await'].includes(word);
  }
  return true;
}

/**
 * Replace every comment byte with a space, preserving offsets and line structure.
 *
 * Offset-PRESERVING on purpose: `lineOffsets`, `enclosingBlockStart`, `bodyEnd` and `pushWindow` all
 * index into the same buffer, so collapsing a comment would shift every position after it. The
 * repository's `stripComments` collapses, which is why this is local rather than a reuse.
 *
 * String and regex literals are SKIPPED so a `//` or an unbalanced quote inside one cannot start a
 * false comment. Skipped, not blanked — that distinction is the whole of the limitations below.
 *
 * Contained — #2258. What this does NOT do, stated as a list because an earlier revision of it
 * omitted the one construct that issue names, and because three separate numbers attached to these
 * paragraphs have since been measured wrong:
 *
 *   1. **Braces inside string and template literals are not neutralised.** They are skipped, so
 *      `enclosingBlockStart` and `bodyEnd` count a `{` inside an ordinary message string as a real
 *      brace. 19 production files carry such a literal today (AST-measured, base and head).
 *   2. **A misfire of the division-versus-regex heuristic fails PERMISSIVE, not conservative.** The
 *      regex branch only advances the cursor; it never blanks. So when a `/` that is really division
 *      is taken for a regex, the span to the next `/` is skipped, and a `//` inside that span never
 *      starts a comment — the comment survives as CODE. A previous revision of this docblock claimed
 *      the opposite ("shrinks a window rather than widening it… fails conservative"); that was
 *      inverted. Live instances: 0 of the enumerated production files, so latent rather than active.
 *   3. JSX is not handled.
 *
 * Whether to blank literals rather than skip them is #2258's open question and is not decided here.
 * The sibling `scan-hook-catalog.mjs` states the same brace limitation plainly; this file used to
 * deny it.
 *
 * On the evidence that used to live here: several end-to-end demonstrations were attached to these
 * limitations and did not reproduce — one claimed a message string ending in `{` flips the scan to
 * exit 0 (408 cases were run against that; none do), another named `/\/dist\//` as the idiom that
 * produced a pre-fix exit 0 (it does not; a regex containing a QUOTE does, by opening a phantom
 * string that swallows the following comment). The limitations are real and are what the list above
 * states; the demonstrations were not, and are removed rather than restated.
 */
export function blankComments(source) {
  const out = source.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '/' && startsRegexLiteral(source, i)) {
      // A REGEX LITERAL, not a comment and not division. Without this branch the `//` inside the
      // trailing `//` of a regex such as `/\/dist\//` reads as a line comment and blanks the REST
      // OF THAT LINE OF LIVE CODE, including a closing `]` or `}`. No corpus count is given here on
      // purpose: three different numbers have been attached to this paragraph and measured wrong,
      // each by a different method. The limitation is what matters and it does not need a count.
      // A blanked unmatched brace makes `bodyEnd` run past its function, which is the permissive
      // direction: an unrelated later function then answers for this one. Measured end to end —
      // with the `blocked` gate deleted and one regex-carrying line added, the scan reported every
      // enforcing row honoured, exit 0.
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        else if (c === '\n') break; // unterminated; treat as not-a-regex rather than eating the file
        i += 1;
      }
      i += 1;
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i];
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

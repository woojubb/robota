/**
 * Is this token a file NAME, or a shape a file ends with?
 *
 * Two checks needed the same answer and each grew its own: the named-artifact scan learned to tell
 * `.eslintrc.json` (a file) from `.test.ts` (a suffix), and the commit-message rule did not — so a
 * message citing `.test.ts` while explaining a convention was refused for naming a file that does
 * not exist. Measured on this repository's own continuous integration, on the commit that shipped
 * the first half.
 *
 * One answer, imported by both. A second spelling of "what counts as a file name" is a second answer
 * waiting to disagree, and here it disagreed the moment the second caller existed.
 */
/**
 * Leading segments that make a dotted token a SUFFIX rather than a dot-file.
 *
 * `.test.ts`, `.spec.ts`, `.d.ts`, `.ptytest.ts` are shapes a file ends with; documents mention them
 * constantly while explaining a convention, and reading them as names reported every such document.
 * A dot-file like `.eslintrc.json` is not on this list and stays in the scan's reach — excluding it
 * silently was the coverage cap review found.
 */
const SUFFIX_SEGMENTS = new Set([
  'd',
  'test',
  'spec',
  'live',
  'ptytest',
  'bintest',
  'config',
  'min',
]);

/**
 * Whether the token is a file NAME rather than an extension or a suffix.
 *
 * `.d.ts` and `.test.ts` are shapes a file ends WITH; they name no file, and reading them as names
 * reported every document that explains a convention. A name needs a stem: something before the
 * extension that is not itself just a dot-part.
 */
export function hasStem(name) {
  const base = name.slice(name.lastIndexOf('/') + 1);
  // A leading dot is allowed — `.eslintrc.json` and `.env.example` are real files, and excluding
  // them dropped them from the scan's reach without saying so, which is the silent cap this
  // repository forbids. What is rejected is a name with NO stem: `.d.ts` and `.test.ts` are shapes a
  // file ends with, so the part before the final extension must itself hold a word character.
  // Drop the leading dot before asking, then require a word character before the FIRST remaining
  // dot. `.eslintrc.json` -> `eslintrc.json`, which has a stem; `.d.ts` -> `d.ts`, whose stem is a (allow-missing-artifact: these two are the shapes being told apart, not files)
  // single letter that names no file — so the stem must be at least two characters. That threshold
  // is the whole difference between a dot-file and a suffix, and it is stated rather than implied.
  // A leading dot means one of two things and they must be told apart. `.eslintrc.json` is a FILE;
  // `.test.ts` and `.d.ts` are SUFFIXES — shapes a file ends with, which name no file and which
  // documents mention constantly while explaining conventions. The difference is not length: it is
  // that a suffix's leading segment is itself an extension-like word the repository uses as one.
  // (allow-missing-artifact: the names in this paragraph are the shapes being explained, not files)
  if (base.startsWith('.')) {
    const rest = base.slice(1);
    // `indexOf` returns -1 when there is no further dot, and `slice(0, -1)` silently drops the last
    // character instead of saying so. Unreachable today — the caller has already required an
    // extension — but a silent wrong answer waiting for the first caller that does not.
    const nextDot = rest.indexOf('.');
    if (nextDot === -1) return false;
    const leading = rest.slice(0, nextDot);
    if (leading.length < 2 || SUFFIX_SEGMENTS.has(leading)) return false;
    return /^[A-Za-z0-9_][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(rest);
  }
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(base);
}

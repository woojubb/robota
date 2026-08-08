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
 *
 * ## Which way its enumeration fails
 *
 * fail-direction: refuse — `SUFFIX_SEGMENTS` below is a closed list, and review rightly asked whether
 * that is the "enumerate what is recognized" shape a gap can slip through. It is not, because of the
 * DIRECTION the gap fails in: a suffix this list does not know is treated as a file STEM, so the
 * token is checked as a path, and a path that does not exist REFUSES the commit and says why. The
 * cost of a missing entry is a visible false refusal someone fixes, not a silent pass.
 *
 * That is the opposite of the allowlist rule 6 forbids, where the gap is a pass nobody sees.
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
 * Extensions a named repository artifact carries. Kept narrow on purpose.
 *
 * Owned HERE rather than in the scan that used to hold it, because two questions need it and the
 * file's own opening paragraph says what a second copy costs: "a second spelling of 'what counts as
 * a file name' is a second answer waiting to disagree". `hasStem` needs it to tell `.gitignore` (a
 * FILE) from `.ts` (an EXTENSION people write in prose constantly), and the named-artifact scan
 * needs it to decide what to look for at all.
 *
 * fail-direction: refuse. An extension missing from this list makes a bare `.foo` mention read as a
 * file name, so it is checked as a path and REFUSES visibly with the reason. The cost of a gap is
 * a false refusal someone fixes, not a silent pass.
 */
// The BOUNDARY of what the artifact checks can see: a slashless token with an extension not on
// this list is no claim at all, so a doc naming a nonexistent `styles.css` goes unchecked. That is
// a deliberate bound, not an oversight — widening it widens two checks over 482 documents at once,
// which is a measured sweep, not a list edit. HARNESS-080 owns the widening.
export const EXTENSIONS = ['mjs', 'cjs', 'js', 'ts', 'tsx', 'md', 'sh', 'yml', 'yaml', 'json'];

/**
 * Is this segment one of the suffix words, whatever its case?
 *
 * Lowercased before the lookup, because the sibling branch already lowercases before checking
 * `EXTENSIONS` and review found the two disagreeing: `.Test.ts` failed the case-sensitive `has` and
 * came out the other side as a genuine dot-FILE. One question, one answer.
 */
function isSuffixSegment(segment) {
  return SUFFIX_SEGMENTS.has(segment.toLowerCase());
}

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
    // A SINGLE-SEGMENT dotfile — `.gitignore`, `.npmrc`, `.nvmrc`, `.editorconfig`. These returned
    // false, which is the same silent coverage cap review had just found for the two-dot case and
    // which was not extended to the one-dot case.
    //
    // The rule needs no new list: the segment is a NAME unless it is an EXTENSION. `.gitignore` is
    // a file; `.ts` and `.md` are what a document writes while explaining a convention, and reading
    // those as names is the failure that once produced 1656 findings from 470 documents. The
    // extension list already existed for the other question and now lives here, so the two answers
    // cannot drift apart.
    //
    // The length floor is unchanged and load-bearing for the same reason it is below: a one-letter
    // segment names no file.
    //
    // `SUFFIX_SEGMENTS` is asked here too, and review found the asymmetry: `.test` and `.config`
    // alone are the same shape as `.test.ts` with the extension left off, and only the two-dot form
    // was excluded. A document writing "files ending in `.test`" was naming a shape, not a file.
    if (nextDot === -1) {
      if (rest.length < 2) return false;
      if (isSuffixSegment(rest) || EXTENSIONS.includes(rest.toLowerCase())) return false;
      return /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(rest);
    }
    const leading = rest.slice(0, nextDot);
    if (leading.length < 2 || isSuffixSegment(leading)) return false;
    return /^[A-Za-z0-9_][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(rest);
  }
  return /^[A-Za-z0-9_][A-Za-z0-9._-]*\.[A-Za-z0-9]+$/.test(base);
}

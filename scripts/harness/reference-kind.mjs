/**
 * INFRA-106 — a `#N` reference states whether it is an issue or a pull request.
 *
 * `#1884` and `#1886` are the same six characters and different things: the first is an issue, the
 * second is the pull request that closed it. A reader cannot tell them apart without opening one, and
 * this repository puts them side by side constantly — a task record cites the issue it came from and
 * the pull request that landed it, in the same paragraph, in the same shape.
 *
 * ONE OWNER, TWO CONSUMERS. `scan-reference-kind-qualified.mjs` applies this to tracked markdown and
 * `commitlint.config.js` applies it to a commit message. A predicate written twice is a rule that can
 * disagree with itself, and the two surfaces would drift the first time either was adjusted.
 *
 * ## What is exempt, and why each one
 *
 * - **A closing keyword.** `Closes #1884` is parsed by GitHub, and INFRA-104 built the promotion
 *   machinery that carries those keywords to the default branch so a finished issue closes itself.
 *   `Closes issue #1884` is not the documented form. Requiring the qualifier there would trade a
 *   readability gain for a broken automation, which is not a trade this rule is worth.
 * - **A fenced block or an inline code span.** An identifier inside one is a specimen — a slot in a
 *   format being shown — not a claim about a particular thing. The same exemption, for the same
 *   reason, that `rule-case-narrative` draws around fenced blocks.
 * - **A link anchor or a URL fragment.** `[text](#section)` and `…/pull/1886#issuecomment-1` do not
 *   name a numbered thing; the `#` is punctuation belonging to the address.
 *
 * ## What it does NOT do
 *
 * It does not check that the kind is CORRECT — that `issue #1886` really is an issue. Deciding that
 * needs the GitHub API, which is a live call this cannot make and a network dependency neither
 * consumer should grow. `claims-resolve` already refuses a commit citing an object that does not
 * exist; this one refuses a reference that does not say what it is. Saying so is part of the check:
 * a floor that lets itself be mistaken for a ceiling is worse than no floor.
 */

/** The kind words, in every spelling this repository uses. */
const QUALIFIER = String.raw`(?:issues?|prs?|pull\s+requests?|pulls?)`;

/**
 * GitHub's closing keywords, which must keep their exact documented shape.
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 */
const CLOSING_KEYWORD = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;

/**
 * A reference, and the text run leading up to it.
 *
 * The lookbehind-free construction is deliberate: a capturing prefix lets the caller see what stood
 * before the number, which is the whole judgement, and keeps this readable next to a lookbehind that
 * would have to enumerate the same alternatives inside out.
 */
const REFERENCE = new RegExp(
  String.raw`(^|[^\w/#])` + // not mid-word, not a URL path, not `##`
    String.raw`(?:(` +
    QUALIFIER +
    String.raw`|` +
    CLOSING_KEYWORD +
    String.raw`)[ \t]+)?` +
    String.raw`#(\d{1,7})\b`,
  'gi',
);

/**
 * Regions where an identifier is a specimen rather than a claim: fenced blocks and inline code spans.
 *
 * Returned as ranges rather than stripped, so a finding's line number still refers to the real line.
 * Blanking the regions in place would work equally well for the count and would shift nothing, but a
 * caller wanting the offending text back could no longer get it.
 */
export function specimenRanges(text) {
  const ranges = [];
  // The unclosed-fence terminator is `(?![\s\S])` — end of INPUT — not `$`. Under the `m` flag `$`
  // matches the end of every LINE, so with a lazy body the fence closed on its own first line:
  // measured on "```\n#1\n```\nsee #1884", which produced the range [0,6] and left the real closing
  // fence to be read as an opening one, hiding the reference after it.
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm;
  let match;
  while ((match = fence.exec(text)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  // Inline spans, one to three backticks, not crossing a blank line — the same bound a markdown
  // renderer applies, and without it an unmatched backtick swallows the rest of the document.
  const span = /(`{1,3})(?:(?!\1)[^\n]|\n(?!\n))*?\1/g;
  while ((match = span.exec(text)) !== null) {
    const inFence = ranges.some(([from, to]) => match.index >= from && match.index < to);
    if (!inFence) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** Whether `index` falls inside any range. */
function within(ranges, index) {
  return ranges.some(([from, to]) => index >= from && index < to);
}

/**
 * Every UNQUALIFIED reference in `text`, as `{ index, line, number, text }`.
 *
 * A markdown link target — `[jump](#1884)` — is excluded by looking at the two characters before the
 * `#`, not by the preceding-character class. The class cannot do it: `(` has to stay admissible
 * because `(#1810)` at the end of a subject line is the ambiguous form this rule exists to qualify,
 * and excluding the paren would exempt exactly the case it was written for. Measured on both.
 */
export function unqualifiedReferences(text) {
  const specimens = specimenRanges(text);
  const findings = [];
  REFERENCE.lastIndex = 0;
  let match;
  while ((match = REFERENCE.exec(text)) !== null) {
    const [whole, prefix, qualifier, number] = match;
    const at = match.index + prefix.length;
    if (qualifier !== undefined) continue;
    if (within(specimens, at)) continue;
    // `](#1884` — a link whose target is a numeric anchor. See the note above for why this is a
    // two-character lookback and not a character class.
    if (text.slice(Math.max(0, at - 2), at) === '](') continue;
    findings.push({
      index: at,
      line: text.slice(0, at).split('\n').length,
      number: Number(number),
      text: text.slice(Math.max(0, at - 24), at + whole.length - prefix.length + 8).trim(),
    });
  }
  return findings;
}

/** How many unqualified references `text` carries. */
export function unqualifiedReferenceCount(text) {
  return unqualifiedReferences(text).length;
}

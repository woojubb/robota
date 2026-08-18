/**
 * INFRA-106 — the predicate both consumers share: does a `#N` say which kind it is?
 *
 * The tree-side scan and the commitlint rule read this one module, so these cases are the single
 * place the rule's meaning is pinned. Both directions for every clause: the bare form reported AND
 * each qualified or exempt form left alone. A predicate shown only to say no is one nobody has shown
 * can say yes, and the exemptions here are load-bearing — a closing keyword feeds the promotion
 * tooling, and an identifier in a fence is a slot in a format rather than a claim about a thing.
 */

import { describe, expect, it } from 'vitest';

import { unqualifiedReferenceCount, unqualifiedReferences } from '../reference-kind.mjs';

describe('what counts as unqualified', () => {
  it('reports a bare reference', () => {
    expect(unqualifiedReferences('see #1884 for the report')).toMatchObject([
      { number: 1884, line: 1 },
    ]);
  });

  it.each([
    ['issue', 'see issue #1884'],
    ['issues', 'see issues #1884'],
    ['PR', 'landed as PR #1886'],
    ['prs', 'see prs #1886'],
    ['pull request', 'landed as pull request #1886'],
    ['mixed case', 'see Issue #1884 and Pull Request #1886'],
  ])('does not report the %s form', (_name, text) => {
    expect(unqualifiedReferenceCount(text)).toBe(0);
  });

  it('reports each reference on a line carrying two', () => {
    expect(unqualifiedReferences('#1884 closed by #1886').map((f) => f.number)).toEqual([
      1884, 1886,
    ]);
  });

  it('gives the line the reference is on, so the finding is one edit away from clean', () => {
    expect(unqualifiedReferences('a\nb\nsee #1884\n')[0].line).toBe(3);
  });
});

describe('the exemptions', () => {
  it.each(['Closes #1884', 'Fixes #1884', 'Resolves #1884', 'closed #1884', 'fix #1884'])(
    'leaves the closing keyword %s alone',
    (text) => {
      // GitHub parses this exact shape, and INFRA-104 built the promotion machinery that carries it
      // to the default branch so a finished issue closes itself. `Closes issue #1884` is not the
      // documented form, so requiring a qualifier here would break automation to gain readability.
      expect(unqualifiedReferenceCount(text)).toBe(0);
    },
  );

  it('leaves an inline code span alone', () => {
    expect(unqualifiedReferenceCount('the token `#1884` in a format')).toBe(0);
  });

  it('leaves a fenced block alone', () => {
    expect(unqualifiedReferenceCount('before\n```\nCloses #1884 and #1885\n```\nafter')).toBe(0);
  });

  it('still reports a bare reference outside the fence that follows one', () => {
    // A fence that swallowed the rest of the document would make every check below it vacuous.
    expect(unqualifiedReferences('```\n#1\n```\nsee #1884').map((f) => f.number)).toEqual([1884]);
  });

  it('leaves a markdown link target alone but not a parenthesised reference', () => {
    // The paren cannot be excluded by a character class: `(#1810)` at the end of a subject line is
    // exactly the ambiguous form this rule exists to qualify.
    expect(unqualifiedReferenceCount('[jump](#1884)')).toBe(0);
    expect(unqualifiedReferenceCount('feat(x): thing (#1810)')).toBe(1);
  });

  it('leaves a URL fragment alone', () => {
    expect(unqualifiedReferenceCount('https://github.com/o/r/pull/1886#issuecomment-1')).toBe(0);
  });

  it('is not confused by a markdown heading', () => {
    expect(unqualifiedReferenceCount('## 1884 heading\n### Another')).toBe(0);
  });
});

describe('the exemptions', () => {
  it.each(['Closes #1884', 'Fixes #1884', 'Resolves #1884', 'closed #1884', 'fix #1884'])(
    'leaves the closing keyword %s alone',
    (text) => {
      // GitHub parses this exact shape, and INFRA-104 built the promotion machinery that carries it
      // to the default branch so a finished issue closes itself. `Closes issue #1884` is not the
      // documented form, so requiring a qualifier here would break automation to gain readability.
      expect(unqualifiedReferenceCount(text)).toBe(0);
    },
  );

  it('leaves an inline code span alone', () => {
    expect(unqualifiedReferenceCount('the token `#1884` in a format')).toBe(0);
  });

  it('leaves a fenced block alone', () => {
    expect(unqualifiedReferenceCount('before\n```\nCloses #1884 and #1885\n```\nafter')).toBe(0);
  });

  it('still reports a bare reference outside the fence that follows one', () => {
    // A fence that swallowed the rest of the document would make every check below it vacuous.
    expect(unqualifiedReferences('```\n#1\n```\nsee #1884').map((f) => f.number)).toEqual([1884]);
  });

  it('leaves a markdown link target alone but not a parenthesised reference', () => {
    // The paren cannot be excluded by a character class: `(#1810)` at the end of a subject line is
    // exactly the ambiguous form this rule exists to qualify.
    expect(unqualifiedReferenceCount('[jump](#1884)')).toBe(0);
    expect(unqualifiedReferenceCount('feat(x): thing (#1810)')).toBe(1);
  });

  it('leaves a URL fragment alone', () => {
    expect(unqualifiedReferenceCount('https://github.com/o/r/pull/1886#issuecomment-1')).toBe(0);
  });

  it('is not confused by a markdown heading', () => {
    expect(unqualifiedReferenceCount('## 1884 heading\n### Another')).toBe(0);
  });
});

describe('what the first run corrected', () => {
  it('does not close an unclosed fence on its own first line', () => {
    // `$` under the `m` flag matches the end of every LINE, so with a lazy body the fence closed
    // immediately and the real closing fence was read as an OPENING one — hiding every reference
    // after it. Measured on this exact text, which reported nothing.
    expect(unqualifiedReferences('```\n#1\n```\nsee #1884').map((f) => f.number)).toEqual([1884]);
  });
});

# A red proof shows a test CAN fail, not that it fails for its stated reason

**The sentence, because it is the whole entry:**

> Name the assertion that failed, and confirm it is this test's subject.

## Why this needs its own entry

"Revert the fix, watch the test go red" is the standard regression proof, and it is necessary. It is
not sufficient, and the gap is invisible: a test that goes red for the wrong reason produces exactly
the same output as one that goes red for the right one.

Four distinct mechanisms produced that gap on ONE branch (SEC-016, issue #2093). The list is the
point — a single instance reads as carelessness; four different mechanisms show the check is needed
regardless of care.

| #   | mechanism                          | what it looked like                                                                                                                                                                                                                                      |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Wrong proxy**                    | The test asserted an executor's ARRAY POSITION in the calling package. The invariant was _which executor runs_, owned by `runHooks` in another package. Position is a proxy for precedence; the proxy held while the property was unpinned.              |
| 2   | **Lucky arrangement**              | A case claimed to pin type-keyed lookup. The executor it expected happened to be the LAST array entry, so a type-blind `list[len - 1]` implementation passed it. Reordering so the winner sits mid-array made the case real.                             |
| 3   | **Cross-test leak**                | Under the mutant, case 1's write SUCCEEDED and leaked state into case 2, which then failed on the leaked value rather than its own property. Both went red; only one was attributable. Fixed by asserting object identity, which the leak cannot affect. |
| 4   | **A mutant that does not compile** | A text edit to the source produced invalid TypeScript. vitest reported `no tests`. That reads close enough to failure to accept — and it proves nothing at all, because the test never loaded.                                                           |

## The check

For each case that went red, ask **which assertion failed**, and whether that assertion names the
property the test claims to pin. Not "did it fail" — _what failed, and is that this test's subject._

Two operational consequences:

- **Verify the mutant compiles / loads before reading its result.** `no tests`, a collection error,
  or an import failure is not a red proof. It is an absent proof wearing red.
- **Mutate more than one way.** Mechanisms 1 and 2 both survive the obvious mutation and die to a
  different one. One mutant tests one hypothesis about how the code could be wrong.

## Related

- [[two-measurements-that-disagree]] — same family, one layer up: there, two numbers for one
  quantity; here, two claims about one test result.
- [[a-verification-line-is-not-a-verification]] — a command that ran nothing, reported as a gate.
  Same substitution: the shape of evidence accepted in place of evidence.
- Issue #2216 — the accidental-green floor cannot read an `it.each` title, so a table-driven suite
  proves nothing. The mechanical cousin of mechanism 1.

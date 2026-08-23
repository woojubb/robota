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

## The same defect one level up: an unfalsified instrument

When eye-reading keeps missing things, the right move is an instrument — a check that derives its
expectation from the source of truth instead of from a reader's model of the file. That is correct,
and it does **not** escape this class. It re-enters it one level up:

> **An instrument that reports clean is only as trustworthy as its derivation, and a broken
> derivation reports clean. An unfalsified instrument is prose wearing a uniform.**

Measured. I built a four-axis SPEC checker (public-export table vs the package root's exports; type
ownership vs the symbols the change adds; every closed-set listing vs the union type; the plan's
affected-files list vs the actual diff). **First run: 21 findings, nearly all defects in the
instrument.** Five of them, and every one is an instance of something already known:

| defect                                                                             | what it is                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| read only committed changes                                                        | a corpus missing the working tree                                                    |
| scraped the whole plan, not its Affected Files section                             | a corpus too wide                                                                    |
| matched `export {` but not `export type {`                                         | **a filter after a correct derivation** — one missing token, thirteen false findings |
| filtered list items on `/^[a-z]+$/`, so `guardrail)` failed                        | a filter that cannot see what it looks for                                           |
| tested "is this disclaimed?" with a line-bounded `[^\n]*` against prose that WRAPS | a corpus that stops before the answer                                                |

**I caught them only because 21 was implausible.** A first run returning **0** is the dangerous
outcome, and it is the one a tidier author gets — a too-narrow derivation reports clean, and clean is
what the author is hoping for. The instrument would then have carried more authority than the
eye-reading it replaced.

### Falsify the derivation, and check the probe

Inject a known defect on each axis and confirm that axis fires. Three of my four did. The fourth did
not — and that turned out to be a **bad probe**, not an unguarded axis: I had picked a symbol that
the document genuinely does disclaim, so passing was correct. Re-probed with a symbol nothing
mentions, and it fired.

> _The instrument passing_ and _the probe being wrong_ look identical from the output, and one of
> them means that axis is guarding nothing.

Probe validity is its own claim, and it does not regress infinitely: check the probe against the code
once, by hand.

**The rule, whole:** prose does not apply a rule; an instrument applies its derivation; falsify the
derivation, and check the probe.

## Related

- [[two-measurements-that-disagree]] — same family, one layer up: there, two numbers for one
  quantity; here, two claims about one test result.
- [[a-verification-line-is-not-a-verification]] — a command that ran nothing, reported as a gate.
  Same substitution: the shape of evidence accepted in place of evidence.
- Issue #2216 — the accidental-green floor cannot read an `it.each` title, so a table-driven suite
  proves nothing. The mechanical cousin of mechanism 1.

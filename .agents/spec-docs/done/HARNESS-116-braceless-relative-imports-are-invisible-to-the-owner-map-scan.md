---
status: done
type: INFRA
tags: [typescript]
---

# HARNESS-116: braceless relative imports are invisible to the owner-map scan

Registered as GitHub issue https://github.com/woojubb/robota/issues/2179.
Follows ARCH-100 (issue #2080), which introduced the scan this corrects.

## Problem

`scripts/harness/scan-interface-family-owner.mjs` exists to prove one property: that the
contract-family owner map in `.agents/specs/contract-family-owner-map.md` yields an **acyclic**
package graph. Six migration leaves (issue #2108 through issue #2113) depend on that proof.

It builds the graph by parsing relative-import edges out of
`packages/agent-interface-transport/src` with a regular expression, and that expression requires
**braces**:

```js
/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'\.\/([a-z-]+)(?:\.m?[jt]s)?'/gms;
```

Two real dependency forms carry no braces:

```ts
export * from './x'; // re-exports everything the target declares
import * as ns from './x'; // binds the target under a namespace
```

**Concrete symptom.** Add `export * from './b-contracts'` to a module owned by package A, where
`b-contracts` is owned by package B and B already imports from A. That is a package cycle. The scan
reports `interface-family-owner scan passed — … the projected package graph is acyclic` and exits 0.

**Reproduction condition.** Any tree in which a braceless form is the only link between two owner
packages. It does not reproduce today because no such edge exists — see Impact.

**Why the gate cannot notice.** It has no way to distinguish "there is no edge here" from "there is an
edge I could not parse". Both produce the same absence, and absence reads as safe.

## Impact today

**Zero live instances outside the barrel**, so no edge is currently dropped and the map's acyclicity
result is not in question. The only star re-export in the package is
`packages/agent-interface-transport/src/index.ts:298`, and `index.ts` is excluded from the graph by
design — the barrel is not a contract module and has no owner in the map. There are no namespace
imports at all.

This is hardening. It is worth doing now rather than later because the six migration leaves will be
adding and rewriting exactly these import lines across nine packages, which is precisely when a new
braceless edge would appear.

## Prior Art Research

- **TypeScript Compiler API — `ts.createSourceFile` / `forEachChild`** (TypeScript wiki, "Using the
  Compiler API", <https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API>). The
  documented way to enumerate a module's imports without pattern-matching text: `ImportDeclaration`
  and `ExportDeclaration` nodes expose `moduleSpecifier` regardless of binding form, so
  `export *`, `import * as`, default and named bindings are all reached by the same traversal. This
  is the reference implementation of the property this spec needs, and it is the basis of
  Alternative B.
- **ESLint — `import/no-cycle`** (eslint-plugin-import documentation,
  <https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md>). A widely
  used implementation of exactly this check — cycle detection over a module graph — built on a real
  resolver rather than text matching, and it counts `export … from` re-exports as edges. Confirms
  that re-exports are conventionally treated as graph edges rather than an edge case, which is the
  assumption this fix encodes.

**How the research feeds the decision.** Both sources say the complete answer is an AST, not a
pattern. That is Alternative B, and it is rejected below on cost rather than on correctness — which
is the honest reason, and it is why TC-04 fixes the residual limit in writing instead of implying the
regex is complete.

## Architecture Review Checklist

- [x] Affected package/layer list complete — `scripts/harness/scan-interface-family-owner.mjs` and its
      test file. No production package is touched.
- [x] Sibling scan complete — `scan-interface-runtime.mjs` and `check-interface-imports.mjs` are the
      adjacent interface-layer scans. Neither builds a module graph, so neither shares this defect;
      `check-dependency-direction.mjs` does build one, but from **package manifests**, not from import
      statements, so it is unaffected by any import spelling.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement:** N/A — no new package, app, presentation or interface surface, and no
layer or product-family reclassification. One existing scan gains cases.

## Alternatives Considered

**A — Extend the pattern to both braceless forms.** (chosen)

- Pro: closes the two known forms; no new dependency; the scan stays a single file with no build
  step; the fix is small enough to be verified by tests that flip the verdict.
- Con: still a pattern, so it remains an enumeration of spellings rather than a parse. A form nobody
  enumerated stays invisible, which is the same class one level down.

**B — Parse with the TypeScript compiler API.**

- Pro: complete by construction. `ImportDeclaration`/`ExportDeclaration` expose `moduleSpecifier`
  whatever the binding form, so the enumeration problem disappears rather than shrinking.
- Con: `typescript` becomes a load-bearing dependency of a harness scan that currently has none, and
  the scan runs inside `run-all-scans` on every push. It also parses a 4,500-line package on each
  run to answer a question about ~36 import statements. The cost is real and the benefit over A is
  bounded by how many braceless spellings exist — the language has few.

**C — Document the limit in the scan header and leave the gap.**

- Pro: zero risk; honest.
- Con: a documented blind spot in the one check standing between the decomposition and a temporary
  cycle. The next person adding `export * from './x'` between two owners gets a green. Rejected — but
  its honest half is kept: A ships **with** the residual limitation written down (TC-04).

## Decision

Adopt **A**, and keep C's disclosure.

The trade-off that drove it: B is the correct answer to the general problem and A is the proportionate
answer to this one. The scan reads a single package whose import style is uniform and small; buying
completeness with a compiler dependency and a per-push parse is not justified by two known forms. But
choosing A means the enumeration problem survives, and a scan that has now been caught by that class
**twice** must not present itself as complete. So the residual is stated in the scan's own header
rather than left for a third finding to discover.

## Completion Criteria

- [x] **TC-01** `projectGraph` returns an edge to the target module's owner for
      `export * from './x'`, asserted on an in-memory source.
- [x] **TC-02** `projectGraph` returns an edge to the target module's owner for
      `import * as ns from './x'`, asserted on an in-memory source.
- [x] **TC-03** `findCycles` reports exactly one cycle for a two-owner graph whose ONLY closing edge
      is braceless, for each of the two forms — and each case is demonstrated to report zero against
      the pre-fix parser.
- [x] **TC-04** The scan's header states which relative-import forms it parses and that a form
      outside that set is invisible to it.
- [x] **TC-05** `node scripts/harness/scan-interface-family-owner.mjs` exits 0 on the real tree and
      still reports the same six owners and acyclic verdict.
- [x] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type          | Tool / Approach                                                                                  | Notes                                                                     |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| TC-01 | Unit               | `vitest` over exported `projectGraph`, in-memory source map                                      | —                                                                         |
| TC-02 | Unit               | `vitest` over exported `projectGraph`, in-memory source map                                      | —                                                                         |
| TC-03 | Unit (falsifying)  | `vitest` over `projectGraph` + `findCycles`; run against the pre-fix parser first to confirm RED | The red-before-green step is manual and recorded in the PR, not automated |
| TC-04 | Document assertion | Read the scan header; assert the parsed-form list and the stated limitation are present          | —                                                                         |
| TC-05 | Integration        | Run the scan on the real tree; compare owner count and verdict to the pre-change run             | —                                                                         |
| TC-06 | Gate               | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                               | manual invocation — `verify-like-ci` is the CI-mirror entry point         |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It corrects the import parser of a
repository verification scan. No CLI command, flag, output, file format or API changes, so there is
nothing a user could run to observe a difference.

The verification surface is the harness gate, recorded in the Test Plan above. A developer can
reproduce the fix with `node scripts/harness/scan-interface-family-owner.mjs`, but that is a
repository check rather than user-facing behavior, and recording it as a user scenario would
misreport what shipped.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE, criterion by
criterion. Recorded as a self-assessment, not a `backlog-gate-guard` verdict — no guardian agent was
dispatched.

- Frontmatter: `---` block; `status: draft`; `type: INFRA` (one of the 11); `tags: [typescript]`.
  `check-spec-doc-frontmatter.mjs` exits 0.
- Problem — concrete symptom: a named construct (`export * from './b-contracts'` closing a two-owner
  cycle) with the exact false output the scan prints and its exit code.
- Problem — reproduction condition: stated, including the honest note that it does not reproduce on
  today's tree and why.
- Problem — no "TBD"/"TODO"/single-sentence vagueness.
- Prior Art Research: 2 documentation sources with links (TypeScript Compiler API wiki;
  `eslint-plugin-import` `no-cycle` docs). Not third-party source code. A "How the research feeds the
  decision" paragraph ties them to Alternative B and to TC-04.
- Architecture Review Checklist: all 4 `[x]`; sibling scan `[x]` naming the three adjacent scans and
  why none shares the defect.
- New-surface placement: N/A with reason — no new package/app/surface, no layer reclassification.
- Alternatives Considered: 3 entries (A/B/C), each with Pro and Con.
- Decision: names the driving trade-off ("B is the correct answer to the general problem and A is the
  proportionate answer to this one") and carries C's disclosure forward rather than discarding it.
- Completion Criteria: 6 items, all `TC-N` prefixed, command or observable-behavior form; none uses
  "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: 6 rows for 6 TCs; every row has Test Type and Tool/Approach; the two rows with a manual
  element (TC-03's red-before-green step, TC-06) carry Notes saying so.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the same standing delegation recorded in ARCH-100's spec-doc, in the three-part form
RULE-012 § Proposed Direction requires. The provenance limit recorded there applies here unchanged
and is not restated; see
`.agents/spec-docs/todo/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` §
GATE-APPROVAL.

**1 — The delegation.** As recorded in ARCH-100: the owner selected the standing-delegation option
「근거가 타당하면 스스로 승인하고 진행하라」, relayed by the orchestrating session. Corroborated
in-repo by `.agents/tasks/RULE-012-…md` § Evidence, which records the same owner's 2026-08-15
instruction and names INFRA-100 as the worked precedent.

**2 — The evidence condition is satisfied.** The defect is not asserted, it is demonstrated: the
brace requirement is visible in the expression quoted in the Problem section, and TC-03 requires each
new case to be shown RED against the pre-fix parser before the fix is applied. The prior instance of
this same class was measured (24 of 36 statements, 67%) rather than estimated.

**3 — The item is inside the delegated class**, and more squarely than ARCH-100 was:

- it changes one repository verification script and its test file — no production package, no
  published surface, no `.agents/rules/` policy file;
- it is reversible and internal;
- it is a correction to a scan this session authored and merged, not a new decision about the
  architecture the scan measures.

Nothing here touches the exclusions (product direction, published contracts, business/legal judgment,
novel repository practice, repository-wide policy). In particular it does **not** touch issue #2180's
INTERFACE-DEPS question, which is with the owner and is not decided by this task.

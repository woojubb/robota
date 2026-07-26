# Check validity has TWO axes — and a guard must be falsified, never trusted green

## STATUS: observed 2026-07-26, across the CI-wide audit (INFRA-060/061, HARNESS-050/052, SEC-005/006/007)

In-repo mirror (memory-mirroring rule). Host mirror: gstack learnings
`two-axes-of-check-validity`, `falsify-guards-never-trust-green`, `noisy-guards-get-suppressed`,
`partial-query-looks-complete`, `id-claimed-at-authoring-time-collides` (project `woojubb-robota`).

## 1. Two independent axes, and passing one is not passing both

**Axis A — can it fail?** Whether enforcement is real.
**Axis B — does it check the RIGHT thing?** Whether behaviour matches what the name promises.

A check can satisfy A and still be broken, because the context name is what a human reads when
deciding whether a merge is safe. Measured instances:

| Check                        | Axis A | Axis B                                                                                                      |
| ---------------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `security audit`             | fine   | named a discipline, ran an OSV **dependency** scan — RENAMED to `dependency audit` (INFRA-060 D5)           |
| `release-grade verification` | fine   | "the FULL sweep" — walks past 5 workspaces via `--if-present`                                               |
| `agent-server-boundary`      | fine   | satisfied **vacuously by a never-called import** — it checks that a token appears, not that a seam is wired |
| `scan-dist-freshness`        | fine   | named freshness, measures **presence**                                                                      |
| `Release — Desktop app`      | fine   | succeeded at _uploading_; the uploaded macOS artifact would not open, undetected for four months            |

**Method:** state each job's PURPOSE in one line — what a reader of that name would reasonably
believe it guarantees — then judge behaviour against it. Verdicts: matches / checks the wrong thing /
over-reaches.

## 2. Falsify. A green run is not evidence.

Break the thing the check exists to catch and confirm it goes red. A check you did not make fail is a
**hypothesis**, and must be reported as one.

**A newly written guard shipped containing the very defect it audited — three times in one session:**

- `scan-guard-scope-fail-closed` — **3 defects**, and _two masked each other_, so a partial
  falsification would have reported it sound. A one-keyword change (`async function` → `function`)
  flipped its verdict on an identical vacuous scan. Its first ledger scored an **import crash** as
  `fail-closed`.
- The gitleaks hardening — satisfied by a _mention_ instead of a wiring (it passed its own red-proof),
  then caught green over an empty subject.
- `scan-review-token-supply` — the reviewer it was repairing found **two** bypasses in it on
  consecutive runs: `github_token: ''` (the quote matches `\S`) and `github_token: # TODO` (YAML
  resolves to null). Either restores the silent skip.

**The author is the last person able to see a guard's blind spot.** Falsification by someone else, or
by execution, is what closes that gap. My own RED proof for `scan-workflow-permissions` did not fire
on the first attempt — the injected `write` sat above an existing `read` and a last-one-wins parser
reported `read`.

## 3. Over-checking is not free rigour

A guard firing on correct data gets suppressed, and a suppressed guard costs more than what it would
catch. Prefer a narrow rule that fires **zero times today** over a broad one that fires on noise.

- Slug-equality between backlog and spec-docs would fire on **34 of 111 correct pairs** (same item,
  reworded: `cjk-ime-defer-submit` vs `ime-last-character-drop`).
- `review-gate` blocks only on `error` / security-high **because all ~100 standing alerts are
  `note`** — a fail-on-any gate would be red on every PR from day one.

## 4. A partial read looks exactly like a complete answer

- `gh` code-scanning alerts sorts `created` **descending** and pages at 100. A burst of note-severity
  alerts pushed all **40 high-severity** ones onto page 2, so a single-page query returned `0 high` on
  **any** ref — I reported a false all-clear to the owner from it.
- Depth-1 directory walks missed **21 nested packages** while a guard _certified_ the tree as covered.
- A per-line CWE-377 detector missed every **Prettier-wrapped** call.
- Grepping the string `typescript` counted `@typescript-eslint` and `@typescript/native-preview`:
  **177 manifests reported, 97 real.**

**Rule:** paginate and assert the processed count matches the API's reported total; parse structure,
never grep a substring of a name.

## 5. An ID claimed at authoring time collides under parallelism

Four collisions in one day — `ARCH-006`/`ARCH-007`, `DIST-002` (reused a number `spec-docs` had
retired), `INFRA-058`, `INFRA-060`. Same shape each time: the number is claimed **when the file is
written**, in a **branch-local** file, against a namespace **no branch can observe atomically**. It
surfaces at merge, when references and citations have already been written against the wrong number.

Owner decision, filed as `PROC-002`: **provisional slug in flight, unique slug issued at merge.**
`check-backlog-placement.mjs` gained a stopgap in the meantime — a backlog file may not be the _first_
to claim an ID `spec-docs` has already spent.

## The ceiling, stated rather than implied

None of this detects a check whose **logic** is subtly wrong, or whose ruleset is merely weak. Those
pass every structural guard. `"all 76 scans passed"` is itself weaker than it reads: HARNESS-052
measured **~30 of that suite vacuous**. These audits proved scanners run, can fail, and examine the
claimed surface — never that their rules are good.

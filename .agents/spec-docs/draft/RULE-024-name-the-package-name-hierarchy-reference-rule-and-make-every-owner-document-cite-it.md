---
status: draft
type: RULE
tags: [typescript]
lane: L2
---

# RULE-024: name the package-name hierarchy reference rule and make every owner document cite it

Paired with `.agents/tasks/RULE-024-name-the-package-name-hierarchy-reference-rule-and-make-every-owner-document-cite-it.md`.
No GitHub issue yet — a local follow-up the owner directed in the session that created STRUCT-012
locally (§ Disposition). Depends on
`.agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`,
which owns the code-side gate this item cites and never re-implements.

## Approval Authority

Every rule document under `.agents/rules/` changes only by amendment
([rules index](../../rules/index.md)); the amendment here is the owner's own instruction, quoted in
§ Disposition. **Lane floor, measured:** L1; declared `lane: L2` so the declaration agrees with STRUCT-012, the item this lands beside (a declaration above the floor is accepted, one that conflicts is refused) — the twelve documents touched are L0 paths and the one
script, `scripts/harness/scan-rule-statement-floor.mjs`, is `scripts/**#non-comment`
([spec-workflow.md](../../rules/spec-workflow.md) § Lane floors). No L2 path is touched: the scan
is already registered in `run-all-scans.mjs:1275`, `harness.config.json` is not read by the
extension, and `gate-catalogue.md:167`'s "All 4 checklist items" is a floor that a fifth ticked item
satisfies (`gate.mjs:826-838`: `items.length < required` fails, more passes). The one optional L2
follow-up is § USER-DECISION.

## Disposition

Owner instruction, verbatim (2026-09-05):

> "우리가 처리한, 패키지 이름에 따른 계층의 참조 규칙은 이름을 신설해서라도 규칙에 명확하게 적어놓고
> 다시는 재발하지 않도록 장치를 넣도록 하세요. 기존 감사 규칙이나 스킬이나 스펙 작성 부분 규칙이나
> 스킬에 명확하게 언급하세요"

Three things are asked, and each is a section of § Solution: a **name** written into the rules; a
**device** against recurrence; and **explicit mentions** in the audit, skill and spec-authoring
documents. The rule's content is fixed by the owner rulings STRUCT-012 records (its § Disposition
1–3, 5–7) and is not re-decided here.

## Problem

### The rule has no normative home

The rule that a package's name declares its layer — and that the dependency rule is derived from the
name — is enforced by STRUCT-012's `checkFamilySiblings` and emitted as `FAMILY-SIBLINGS`. Where a
reader can find it, measured at `4b03d3248`:

```
$ git grep -l "FAMILY-SIBLINGS"
.agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md
```

One file, and it is a plan. `scripts/harness/scan-rule-statement-floor.mjs:21-24` (`isNormativeDoc`)
returns `false` for every path under `.agents/spec-docs/` by design — "Archived paths and completed
spec-docs are deliberately NOT normative: accepting them is what made design 1 green for the wrong
reason." So until STRUCT-012 S1 writes its one sentence into `ARCHITECTURE.md`, the rule is stated
nowhere normative, and after S1 it is stated in exactly one sentence that no authoring, review or
audit document points at.

### The recurrence, measured

The same defect — a lower layer wearing a sibling's family prefix, and siblings importing it — was
filed three times, each time discovered by a human audit re-deriving the rule from a prefix:

| Record                | Package                                                    | How it was found                                                                     |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `STRUCT-011`          | `agent-provider-defaults` → `agent-builtin-providers`      | owner ruling on issue #2198, 2026-08-23; rename of 63 live files                     |
| `STRUCT-012`          | `agent-transport-protocol` (6 sibling edges)               | owner ruling 2026-09-05; the absorbed issue #2197 draft had read the prefix by hand  |
| `STRUCT-012` baseline | `agent-provider-openai → agent-provider-openai-compatible` | found only by the prototype gate written for STRUCT-012, frozen pending its own item |

None of the documents that should have refused the first one mention the rule. Measured, the
documents an author or reviewer actually reads when a package is introduced or a dependency is added
— and what each says today about family, parent or sibling edges:

| Document                                                                     | Mentions the rule today | What it does say                                                                   |
| ---------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `.agents/rules/naming-style.md`                                              | no                      | language policy, reference kinds, agent identity, styling                          |
| `.agents/rules/code-quality.md` § Import Standards (`:23-27`)                | no                      | static imports by default; dynamic imports gated                                   |
| `.agents/rules/common-mistakes.md` (94 entries)                              | no                      | entry 3 "bidirectional package dependencies", entry 4 pass-through re-exports      |
| `.agents/skills/spec-writing-standard/SKILL.md`                              | no                      | SPEC.md creation/update modes                                                      |
| `.agents/skills/backlog-writer/SKILL.md` checklist (`:74-78`)                | no                      | four items: scope, sibling scan (of CLI command families), alternatives, rationale |
| `.agents/templates/spec-template.md` § Architecture Overview                 | no                      | points at `ARCHITECTURE-MAP.md` and `package.json` for layer and edges             |
| `.agents/skills/architecture-patterns/SKILL.md`                              | no                      | principles and application                                                         |
| `.agents/skills/package-code-review/SKILL.md` (six perspectives)             | no                      | severity labels, depth axis, perspectives                                          |
| `.agents/skills/architecture-audit-fanout/SKILL.md`                          | no                      | pipeline over four dimensions                                                      |
| `.agents/skills/version-management/SKILL.md` § Adding a new package (`:101`) | no                      | version alignment steps                                                            |
| `.claude/agents/architecture-structure-auditor.md` § Checklist               | no                      | responsibility placement, boundaries, dependency direction (generic)               |
| `.claude/agents/proposal-reviewer.md` § Architecture-placement check         | no                      | mirror an analog layer; reuse at the contract level                                |

`.claude/agents/arch-audit-structure.md`, named in the instruction, does not exist at `4b03d3248`
(`find .claude .agents -name "arch-audit-structure*"` → nothing); the Korean-language
`arch-audit-*` agents are registered under other paths and are out of this item's list, stated
rather than silently dropped.

### No scaffold, so no scaffold checkpoint

There is no package-creation script or skill: `ls scripts/harness | grep -iE "new-package|create-package|scaffold"`
→ nothing, and no `.agents/skills/*` matches. A new package is created by hand following
`version-management/SKILL.md` § Adding a new package and the spec-doc pipeline. Those two are the
only creation-path checkpoints that exist, and neither asks what family the name declares.

## Prior Art Research

Reused by reference, not waived: STRUCT-012's `## Prior Art Research` § Axis 5
(`.agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`)
consulted ten package families (TanStack Query, tRPC, Connect-ES, libp2p, OpenTelemetry JS, Vercel
AI SDK, MCP TypeScript SDK v2, Socket.IO, Hono, LangChain JS) and five enforcement tools (Nx,
dependency-cruiser, eslint-plugin-boundaries, Turborepo Boundaries, syncpack) from product
documentation and published manifests, with URLs. The observations this item rests on, cited from
that axis: the family root is the contract plus runtime-neutral shared logic and depends on neither
the framework nor a child (10/10); sibling-shared code lives in a root subpath first (tRPC
`./shared`, Connect `./protocol*`, Hono `./adapter`) and no `-common`/`-shared`/`-protocol` package
exists in any of the ten; the composer depends on the contract, never on a child; the enforcement
shape matching a name-derived rule is a capture rule (dependency-cruiser `$1`,
https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md;
eslint-plugin-boundaries `captured.family`, https://www.jsboundaries.dev/docs/selectors/).

Two further references, from documentation, on the **document-side** device this item adds:

- **Nx, "Enforce Module Boundaries"** (https://nx.dev/docs/features/enforce-module-boundaries):
  "You can declaratively define constraints using project tags and enforce them automatically" — the
  constraint lives in one declared place and every consumer (lint, graph, docs) reads it; the rule is
  not restated per consumer.
- **Turborepo, "Structuring a repository"**
  (https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository): "avoid accessing
  files across package boundaries as much as possible" — a repository-level rule stated in the
  repository's own guidance, which is the layer the owner's instruction targets.

And the repository's own precedent, `HARNESS-117` (issue #2178), whose scan header states the design
this item extends rather than forks: "**A SCAN FILE IS NOT THE UNIT OF ENFORCEMENT; A RULE IDENTIFIER
IS.**" — the identifier is the thing that must be stated once and, here, cited wherever it binds.

**Constraint that applies:** the code-side rule is owned by STRUCT-012 and must not be duplicated in
a second parser or a second scan — one fact, one implementation; this item adds statements and
citations, and a floor that keeps the citations present.

## Architecture Review

### Affected Scope

- `ARCHITECTURE.md` § Dependency and interface rule identifiers — the `FAMILY-SIBLINGS` sentence
- `.agents/project-structure.md` § Dependency direction — the rule body, in the section's existing form
- `.agents/rules/naming-style.md`, `.agents/rules/code-quality.md`, `.agents/rules/common-mistakes.md`
- `.agents/skills/spec-writing-standard/SKILL.md`, `.agents/skills/backlog-writer/SKILL.md`,
  `.agents/templates/spec-template.md`, `.agents/skills/architecture-patterns/SKILL.md`,
  `.agents/skills/package-code-review/SKILL.md`, `.agents/skills/architecture-audit-fanout/SKILL.md`,
  `.agents/skills/version-management/SKILL.md`
- `.claude/agents/architecture-structure-auditor.md`, `.claude/agents/proposal-reviewer.md`
- `scripts/harness/scan-rule-statement-floor.mjs` and `scripts/harness/__tests__/scan-rule-statement-floor.test.mjs`

### Sibling scan

Every document class the instruction names was enumerated and read: the rules tree (`naming-style`,
`code-quality`, `common-mistakes` are the three whose subject the rule touches; `git-branch`,
`process`, `frontend` are not), the authoring skills (`spec-writing-standard`, `backlog-writer` —
the actual owner of the spec-doc schema and checklist; `.agents/templates/spec-template.md` is the
_package_ SPEC template and has no checklist, so the checklist item lands in `backlog-writer`'s
schema and the template gains one line in § Architecture Overview), the audit skills
(`architecture-patterns`, `package-code-review`, `architecture-audit-fanout`; `design-quality-audit`
was read and is a design-quality pipeline with no structure perspective, so it is not in the list),
the agent definitions (`architecture-structure-auditor`, `proposal-reviewer`; `arch-audit-structure`
does not exist as a `.claude/agents/*.md` file), and the harness scans that could carry the
document-side device (`scan-rule-statement-floor`, `scan-retired-agent-references`,
`harness-coverage-declarations`, `scan-conflict-markers`, `audit-spec-coverage`).

### Alternatives Considered

1. **State the rule once (SSOT), cite it in every listed document, and extend
   `scan-rule-statement-floor.mjs` with a citation floor (recommended).** **Pro:** one statement, no
   second parser of the code rule; the citations are kept present by a check keyed on the identifier
   — the unit HARNESS-117 already chose; the extension lives in an already-registered scan, so the
   lane stays L1 and no L2 registry or config file moves. **Con:** the statement floor's scope
   widens from "stated once" to "stated once and cited where declared", which its header must say;
   and a declaration inside the scan file is one more list a writer maintains.
2. **State and cite, no mechanism (L0).** **Pro:** smallest change; every path is documentation.
   **Con:** the owner asked for a device ("장치를 넣도록"), and without one the next edit that trims a
   skill removes the citation silently — the shape HARNESS-117 measured ("Delete all five and
   `pnpm harness:scan` stays green").
3. **A new scan, `scan-rule-citation-floor.mjs`.** **Pro:** the two floors stay separate files.
   **Con:** a new scan must be registered in `scripts/harness/run-all-scans.mjs`, an L2 path — the
   lane rises for a bookkeeping reason, and the design splits one identifier-keyed unit across two
   files that can disagree about which identifiers exist.
4. **Rely on STRUCT-012's code gate alone.** **Pro:** nothing to write. **Con:** the code gate refuses
   a manifest edge after it is written; the owner's instruction is about the documents that guide an
   author before it is written, and the three recurrences each cost a rename.
5. **Put the rule body in `common-mistakes.md` instead of `project-structure.md`.** **Pro:** the
   mistakes catalogue is where agents look first. **Con:** `project-structure.md:180-183` already
   states that the catalogue carries the universal form and this document carries "the package that
   form resolves to"; `AGENTS.md` names it the owner of dependency rules. The catalogue gets the
   pattern as an entry that links here.

### Decision

**Alternative 1.** The rule gets its name and one home; twelve documents cite it in one paragraph or
one checklist item each; the citation floor keeps them citing.

**The SSOT statement.** `ARCHITECTURE.md` § Dependency and interface rule identifiers gains, in that
list's existing form:

> - `FAMILY-SIBLINGS` — 패키지 이름 계층 참조 규칙. A workspace package named `agent-<family>-<child>`
>   may depend on its parent `agent-<family>` and on lower families; it never depends on a sibling
>   `agent-<family>-<other>` at any depth (the family is the second dash segment; a compound name is
>   a name, not a layer), the parent never depends on a child, and `agent-framework`/`agent-core`
>   never depend on a transport or UI child. Code shared among siblings lives in the parent or a
>   parent subpath; a sibling-named substrate (`-common`, `-shared`, `-protocol`, `-defaults`,
>   `-builtin`) is refused. `agent-interface-*` is judged by `INTERFACE-DEPS`.
>   Enforced by: `deps` (`check-dependency-direction.mjs`, `checkFamilySiblings` — STRUCT-012)

and `.agents/project-structure.md` § Dependency direction gains the rule body in the section's
existing prose form (statement, the three owner rulings it descends from, `Enforced by:`), with the
family table this rule reads: `agent-transport`, `agent-ui`, `agent-provider`, `agent-session`,
`agent-remote`, `agent-tool`, `agent-cli`, `agent-command`, `agent-interface` (delegated).

**The citations, each one paragraph or one item, each linking the SSOT:**

| Document                                              | The one addition                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `naming-style.md`                                     | new subsection "Package names declare a layer": the name is the rule's input (`FAMILY-SIBLINGS`); choosing a name chooses what the package may import                                    |
| `code-quality.md` § Import Standards                  | one bullet: a workspace import is legal only if `FAMILY-SIBLINGS` allows the manifest edge; link                                                                                         |
| `common-mistakes.md`                                  | entry **95**: "Creating a sibling-named substrate (`-protocol`, `-defaults`, …) and importing it from siblings" → put shared code in the parent; `Mechanism:` `deps` (`FAMILY-SIBLINGS`) |
| `spec-writing-standard/SKILL.md`                      | one paragraph in Mode A steps: a SPEC for a new package states family, parent and `sibling edges: 0` and links `FAMILY-SIBLINGS`                                                         |
| `backlog-writer/SKILL.md` schema                      | fifth checklist item: `- [ ] 패키지 가족·부모·형제 엣지 0 진술 완료 — 또는 N/A: 새 패키지 없음` (`FAMILY-SIBLINGS`); the guide gains its one-line rule                                   |
| `spec-template.md` § Architecture Overview comment    | one line: family, parent, and that sibling edges are refused by `FAMILY-SIBLINGS`                                                                                                        |
| `architecture-patterns/SKILL.md` § Principles         | one principle: the name hierarchy is the dependency rule; link                                                                                                                           |
| `package-code-review/SKILL.md` § Review Perspectives  | one line under the structure perspective: a new manifest edge is judged by `FAMILY-SIBLINGS`                                                                                             |
| `architecture-audit-fanout/SKILL.md`                  | one line in the structure dimension's brief: `FAMILY-SIBLINGS` is a named criterion, not a re-derived heuristic                                                                          |
| `version-management/SKILL.md` § Adding a new package  | one step: parse the name — family exists? parent exists? sibling dependencies 0? — before the version step                                                                               |
| `architecture-structure-auditor.md` § Checklist       | one item: judge family/parent/sibling edges against `FAMILY-SIBLINGS`, and report a prefix-derived layer claim as a finding only when the rule says so                                   |
| `proposal-reviewer.md` § Architecture-placement check | one item: a proposal that introduces or renames a package states its family and parent and has zero sibling edges (`FAMILY-SIBLINGS`); judged explicitly, not inferred                   |

**The device.** `scan-rule-statement-floor.mjs` gains a `RULE_CITATION_FLOOR` declaration —
`{ 'FAMILY-SIBLINGS': [ ...the twelve paths above ] }` — and a second pass: for each declared
identifier, every listed document must exist and contain the literal identifier; a missing document
is a finding (not "nothing to check"), a document without the literal is a finding, and the first
pass — the statement floor — is byte-identical for every other identifier (TC-05). The header
gains the sentence that widens its scope. Red-proof: the scan's test file plants a document set with
one citation removed and one listed path absent and asserts a finding for each (TC-04).

**Why not a third checkpoint on package creation.** None exists to hook: the creation path is the
`version-management` steps and the spec-doc pipeline, both of which now ask the question, and
STRUCT-012's `checkFamilySiblings` refuses the manifest edge a writer skips past. A scaffold script
would be a new surface this item has no ground to invent.

**Validation before approval.** _Reachability_ — every document in the table exists at
`4b03d3248` (the one named path that does not, `arch-audit-structure.md`, is stated in § Problem);
the scan already walks every listed path class (`isNormativeDoc`, `:21-30`). _Capability
preservation_ — the statement floor's finding set is asserted unchanged (TC-05); `gate.mjs`'s
checklist criterion accepts five items today (`:826-838`). _Adversarial pass_ — (a) a citation
present as a code-fence specimen counting as a citation: the pass reads the document with fenced
blocks stripped, as `gate.mjs` does for `## Problem`; (b) the declaration listing a path that was
later moved: a missing path is a finding, so a rename of a skill fails the scan until the list
follows; (c) the fifth checklist item ticked by habit with "N/A" on a spec that does introduce a
package: judged by `backlog-gate-guard` at GATE-WRITE like the sibling-scan item, and by
`proposal-reviewer`'s new placement item at GATE-APPROVAL — two readers, stated so it is not
claimed as mechanical.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 2 SSOT documents, 10 citing documents, 2 agent definitions, 1 scan + its test; § Affected Scope
- [x] Sibling scan 완료 — every rules/skills/agents/scan class the instruction names enumerated, with the two named-but-absent or out-of-scope items stated; § Sibling scan
- [x] 대안 최소 2개 검토 완료 — five alternatives with Pro and Con; the lane consequence of each stated
- [x] 결정 근거 문서화 완료 — § Decision: the statement text, the twelve citations, the device, and three adversarial cases

## Fallback & Degradation Declaration

**None.** The citation floor refuses rather than skips: a listed document that does not exist is a
finding, not an empty pass, and a document without the literal is a finding.

## Solution

1. `ARCHITECTURE.md`: add the `FAMILY-SIBLINGS` entry quoted in § Decision to § Dependency and
   interface rule identifiers, coordinated with STRUCT-012 S1 (whichever lands first writes it;
   the other verifies it is present and identical).
2. `.agents/project-structure.md` § Dependency direction: add the rule body and family table.
3. The twelve one-paragraph / one-item citations in § Decision's table, each linking
   `ARCHITECTURE.md#dependency-and-interface-rule-identifiers`; `common-mistakes.md` entry 95 in the
   catalogue's row form with `Mechanism:`.
4. `backlog-writer/SKILL.md`: fifth checklist item in the schema and one guide line;
   `spec-template.md`: one line in the § Architecture Overview comment.
5. `scan-rule-statement-floor.mjs`: `RULE_CITATION_FLOOR` declaration, second pass, header sentence;
   test cases in `scripts/harness/__tests__/scan-rule-statement-floor.test.mjs`.
6. `version-management/SKILL.md` § Adding a new package: the family/parent/sibling step.

## Affected Files

| File                                                           | Change                                             |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `ARCHITECTURE.md`                                              | `FAMILY-SIBLINGS` normative sentence               |
| `.agents/project-structure.md`                                 | rule body + family table in § Dependency direction |
| `.agents/rules/naming-style.md`                                | subsection "Package names declare a layer"         |
| `.agents/rules/code-quality.md`                                | one bullet in § Import Standards                   |
| `.agents/rules/common-mistakes.md`                             | entry 95                                           |
| `.agents/skills/spec-writing-standard/SKILL.md`                | one paragraph in Mode A                            |
| `.agents/skills/backlog-writer/SKILL.md`                       | fifth checklist item + guide line                  |
| `.agents/templates/spec-template.md`                           | one line in § Architecture Overview                |
| `.agents/skills/architecture-patterns/SKILL.md`                | one principle                                      |
| `.agents/skills/package-code-review/SKILL.md`                  | one line in the structure perspective              |
| `.agents/skills/architecture-audit-fanout/SKILL.md`            | one line in the structure brief                    |
| `.agents/skills/version-management/SKILL.md`                   | one step in § Adding a new package                 |
| `.claude/agents/architecture-structure-auditor.md`             | one checklist item                                 |
| `.claude/agents/proposal-reviewer.md`                          | one placement-check item                           |
| `scripts/harness/scan-rule-statement-floor.mjs`                | `RULE_CITATION_FLOOR` + second pass + header       |
| `scripts/harness/__tests__/scan-rule-statement-floor.test.mjs` | red-proof cases                                    |

## Completion Criteria

- [ ] TC-01: `grep -c '^- \`FAMILY-SIBLINGS\` — 패키지 이름 계층 참조 규칙' ARCHITECTURE.md`→ prints`1`, and `node scripts/harness/scan-rule-statement-floor.mjs` → exits 0
- [ ] TC-02: `awk '/^### Dependency direction/,/^## Library Neutrality Rule/' .agents/project-structure.md | grep -c "FAMILY-SIBLINGS"` → prints a number ≥ 1
- [ ] TC-03: `for f in .agents/rules/naming-style.md .agents/rules/code-quality.md .agents/rules/common-mistakes.md .agents/skills/spec-writing-standard/SKILL.md .agents/skills/backlog-writer/SKILL.md .agents/templates/spec-template.md .agents/skills/architecture-patterns/SKILL.md .agents/skills/package-code-review/SKILL.md .agents/skills/architecture-audit-fanout/SKILL.md .agents/skills/version-management/SKILL.md .claude/agents/architecture-structure-auditor.md .claude/agents/proposal-reviewer.md; do grep -q "FAMILY-SIBLINGS" "$f" || echo "MISSING $f"; done` → prints nothing (it prints twelve `MISSING` lines today)
- [ ] TC-04: `pnpm exec vitest run scripts/harness/__tests__/scan-rule-statement-floor.test.mjs` → exits 0 asserting that a planted document set with one listed document lacking `FAMILY-SIBLINGS` yields a finding naming that document, and a set with one listed path absent yields a finding naming that path; exits 1 if either case passes silently
- [ ] TC-05: `node scripts/harness/scan-rule-statement-floor.mjs 2>&1 | grep -vc "FAMILY-SIBLINGS"` → prints the same count before and after the extension (the statement floor's findings for every other identifier are unchanged)
- [ ] TC-06: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <fixture spec with five ticked checklist items> --lane L1 --dry-run` → the `checklist-all-ticked` criterion prints `PASS`; with the fifth item unticked → prints `FAIL`
- [ ] TC-07: `pnpm harness:scan` → exits 0, and `grep -c "FAMILY-SIBLINGS" .agents/rules/common-mistakes.md` → prints a number ≥ 1 on a row numbered `95`

## Test Plan

Derived from `type: RULE` with tag `typescript`; every criterion is a command over the tree or the
scan's own test file.

| TC-ID | Test Type                    | Tool / Approach                                | Notes                                                                       |
| ----- | ---------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| TC-01 | Command (SSOT statement)     | `grep -c` + the statement floor                | The sentence exists in the one form the floor reads                         |
| TC-02 | Command (rule body)          | `awk` section slice + `grep -c`                | Body sits in the owner document's dependency-direction section              |
| TC-03 | Command (citations)          | `grep -q` loop over the twelve documents       | Red today (twelve `MISSING`), green after                                   |
| TC-04 | Contract (red-proof)         | `pnpm exec vitest run` on the scan's test file | Missing citation and missing path are both findings                         |
| TC-05 | Regression (statement floor) | finding-count comparison before/after          | Capability preservation of HARNESS-117's floor                              |
| TC-06 | Gate (checklist floor)       | `gate.mjs judge --dry-run` on a fixture spec   | Five ticked items pass; an unticked fifth fails — the spec-authoring device |
| TC-07 | Suite                        | `pnpm harness:scan` + `grep -c`                | The repository's full scan set, including the extended floor                |

## User Execution Test Scenarios

Not applicable.

**Reason:** Naming a rule, writing it into the repository's guidance documents and keeping those
citations present changes nothing a person can observe through the CLI, the terminal UI or the
browser monitor; every session, message and command behaves identically before and after.

## USER-DECISION

- **Raise `gate-catalogue.md:167` from "All 4 checklist items" to "All 5".** Optional: the criterion
  is a floor and five ticked items already pass; raising it makes the fifth item mandatory by count
  rather than by the writer's schema. It is an L2 path (`.agents/specs/gate-catalogue.md`), so it is
  offered as a separate owner step rather than folded into this L1 item.

## Tasks

- [ ] `.agents/tasks/RULE-024-name-the-package-name-hierarchy-reference-rule-and-make-every-owner-document-cite-it.md` — todo

## Evidence Log

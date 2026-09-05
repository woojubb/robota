---
title: 'RULE-024: name the package-name hierarchy reference rule and make every owner document cite it'
status: todo
created: 2026-09-05
priority: high
urgency: soon
area:
  - ARCHITECTURE.md
  - .agents/project-structure.md
  - .agents/rules/naming-style.md
  - .agents/rules/code-quality.md
  - .agents/rules/common-mistakes.md
  - .agents/skills/spec-writing-standard/SKILL.md
  - .agents/skills/backlog-writer/SKILL.md
  - .agents/templates/spec-template.md
  - .agents/skills/architecture-patterns/SKILL.md
  - .agents/skills/package-code-review/SKILL.md
  - .agents/skills/architecture-audit-fanout/SKILL.md
  - .agents/skills/version-management/SKILL.md
  - .claude/agents/architecture-structure-auditor.md
  - .claude/agents/proposal-reviewer.md
  - scripts/harness/scan-rule-statement-floor.mjs
depends_on: [STRUCT-012]
no-issue: the owner directed this follow-up locally, in the same session that created STRUCT-012 locally — "우리가 처리한, 패키지 이름에 따른 계층의 참조 규칙은 이름을 신설해서라도 규칙에 명확하게 적어놓고 다시는 재발하지 않도록 장치를 넣도록 하세요. 기존 감사 규칙이나 스킬이나 스펙 작성 부분 규칙이나 스킬에 명확하게 언급하세요" (2026-09-05); registration on GitHub is the owner's step
---

# RULE-024: name the package-name hierarchy reference rule and make every owner document cite it

## Objective

The owner, verbatim (2026-09-05):

> "우리가 처리한, 패키지 이름에 따른 계층의 참조 규칙은 이름을 신설해서라도 규칙에 명확하게 적어놓고
> 다시는 재발하지 않도록 장치를 넣도록 하세요. 기존 감사 규칙이나 스킬이나 스펙 작성 부분 규칙이나
> 스킬에 명확하게 언급하세요"

The rule STRUCT-012 enforces in code — a package's name declares its layer, and the dependency
rule is derived from the name — exists today in exactly one place a reader can find: the STRUCT-012
spec-doc, which is a plan, not a rule. Measured at `4b03d3248`: `git grep -l "FAMILY-SIBLINGS"` returns
one file, `.agents/spec-docs/backlog/STRUCT-012-…`, and `scan-rule-statement-floor.mjs` deliberately
treats `.agents/spec-docs/` as non-normative. No rule document, no authoring skill, no audit skill
and no reviewer agent definition states or cites it. That is how the same defect was filed three
times under three names — `agent-provider-defaults` (STRUCT-011), `agent-transport-protocol`
(STRUCT-012), `agent-provider-openai-compatible` (frozen in STRUCT-012's baseline) — each time
discovered by an audit re-deriving the rule from a prefix, never by a document that stated it.

This item gives the rule its name and its normative home, makes every document that authors,
reviews or audits package structure cite that home, and adds the smallest mechanism that keeps the
citations from disappearing:

1. **Name and SSOT.** Identifier `FAMILY-SIBLINGS` (the one STRUCT-012's gate already emits), titled
   "패키지 이름 계층 참조 규칙". One normative sentence in `ARCHITECTURE.md` § Dependency and interface
   rule identifiers (the form `rule-statement-floor` reads) and the rule body in
   `.agents/project-structure.md` § Dependency direction, in that section's existing form. Content:
   `agent-<family>-<child>` may depend on its parent `agent-<family>` and on lower families only;
   never on a sibling `agent-<family>-<other>` at any depth; the parent never depends on a child;
   `agent-framework`/`agent-core` never depend on a transport or UI child; family = the second dash
   segment; code shared among siblings lives in the parent (or a parent subpath); no sibling-named
   substrate of the `-common`/`-shared`/`-protocol`/`-defaults`/`-builtin` kind (owner rulings 3, 5,
   6 in STRUCT-012).
2. **Explicit mentions, one paragraph or one checklist item each, linking the SSOT rather than
   restating it:** `naming-style.md` (a package name is a layer declaration), `code-quality.md`
   § Import Standards, `common-mistakes.md` (the recurrence pattern as entry 95),
   `spec-writing-standard/SKILL.md` and the spec-doc schema in `backlog-writer/SKILL.md` (a spec
   introducing a package states family, parent and "sibling edges: 0" in its Architecture Review —
   as a fifth checklist item, which `gate.mjs` checks mechanically), `spec-template.md`,
   `architecture-patterns/SKILL.md`, `package-code-review/SKILL.md`,
   `architecture-audit-fanout/SKILL.md`, `version-management/SKILL.md` § Adding a new package, and
   the agent definitions `architecture-structure-auditor.md` and `proposal-reviewer.md` (the
   placement check judges this rule explicitly).
3. **Recurrence devices.** Code side: STRUCT-012 S1's `checkFamilySiblings` — referenced, never
   duplicated. Document side: extend `scan-rule-statement-floor.mjs` with a **citation floor** — a
   declaration inside the scan mapping an identifier to the documents that must cite it — so a
   listed document losing its `FAMILY-SIBLINGS` mention is a finding. New-package side: there is no
   scaffold script in this repository (measured: no `new-package`/`create-package`/`scaffold` under
   `scripts/harness/`, no such skill), so the creation path is the `version-management` skill's
   "Adding a new package" steps plus the spec-doc checklist item; both gain the family/parent/sibling
   check, and the code gate catches what a writer skips.

## Why it is not being solved elsewhere

STRUCT-012 enforces the rule in code and states its one normative sentence in `ARCHITECTURE.md` (its
S1). It does not touch the rules, skills, templates or agent definitions — the owner's instruction
is about those. `rule-statement-floor` (HARNESS-117) guarantees an emitted identifier is _stated_
once; it does not guarantee the documents that guide authors and reviewers _cite_ it, and that gap
is exactly where the three recurrences lived.

## Approval boundary

A change to `.agents/rules/*` is a rule amendment, and the owner directed it in the quoted
instruction. The measured lane floor is **L1**: every document touched is L0, and the one script,
`scripts/harness/scan-rule-statement-floor.mjs`, is `scripts/**#non-comment` (L1). No L2 path is
touched — the scan is already registered in `run-all-scans.mjs`, so extending it needs no registry
change, and neither `harness.config.json` nor `gate-catalogue.md` changes (the checklist criterion
reads "All 4" as a floor, and a fifth ticked item passes). The paired spec's `## USER-DECISION`
carries the one optional L2 follow-up (raising the catalogue's "All 4" to "All 5").

## Plan

- [ ] Write the `FAMILY-SIBLINGS` normative sentence in `ARCHITECTURE.md` (coordinated with
      STRUCT-012 S1: whichever lands first writes it; the other finds it present) and the rule body
      in `.agents/project-structure.md` § Dependency direction.
- [ ] Add the one-paragraph / one-item citations to the twelve documents listed in `area`, each
      linking the SSOT.
- [ ] Add the fifth Architecture Review Checklist item to the spec-doc schema in
      `backlog-writer/SKILL.md` and the family/parent/sibling line to `spec-template.md`.
- [ ] Extend `scan-rule-statement-floor.mjs` with the citation floor (declaration + check + a
      red-proof test case in its test file), leaving the statement floor's behaviour byte-identical
      for every other identifier.
- [ ] Add the family/parent/sibling step to `version-management/SKILL.md` § Adding a new package.

## Test Plan

TC-01 asserts the normative sentence exists in the form `rule-statement-floor` reads and that the
scan is green with it. TC-02 asserts the rule body sits in `project-structure.md` under the
dependency-direction section. TC-03 is a `grep -c` over each of the twelve documents for the literal
`FAMILY-SIBLINGS`. TC-04 is the red-proof of the citation floor: the scan's test file plants a
document set in which one listed document lacks the identifier and asserts a finding, and a set in
which a listed document does not exist and asserts a finding (a missing document must not read as
"nothing to check"). TC-05 asserts the statement floor is unchanged: the finding set for every other
identifier is identical before and after. TC-06 asserts the fifth checklist item is accepted by
`gate.mjs` (a dry-run over a fixture spec with five ticked items passes, and with the fifth unticked
fails). TC-07 is `pnpm harness:scan` green. All seven are stated in command form in the paired spec.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Naming a rule, writing it into the repository's own guidance documents and keeping
those citations in place changes nothing a person can observe through the CLI, the terminal UI or
the browser monitor; every session, message and command behaves the same before and after, and the
only readers affected are the people and agents who author or review package structure.

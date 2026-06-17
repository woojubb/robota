---
status: done
type: RULE
tags: [typescript]
---

# RULE-002: Adopt RCP communication & formatting style with unlimited precedence

## Problem

The user has decided to adopt the external reference conduct profile (RCP) as the governing authority for
agent conduct in this harness, with **unlimited RCP precedence**: where any RCP principle
conflicts with an existing harness rule, RCP wins. This draft covers exactly one area —
**communication and formatting style** — extracted from the RCP `tone_and_formatting` /
`lists_and_bullets` section and the format-relevant parts of `evenhandedness`.

The current harness has no communication or formatting discipline at all. `naming-style.md` owns
only language policy (English code, Korean conversation) and Korean prose style; it says nothing
about prose-vs-bullets, formatting minimalism, question discipline, or tone. So almost every
RCP communication principle is a clean addition.

The one genuine conflict is decisive. RCP requires that "reports, documents, technical
documentation, and explanations" be written as prose without bullets, numbered lists, or excessive
bolding. But this repo uses markdown structure itself as a machine-parsed contract: SPEC.md
required sections, backlog frontmatter, and comparison tables are structural invariants checked by
`harness:scan` and consumed by the gate pipeline. Applying the prose rule literally to those
artifacts would break them. The resolution is scope separation, not refusal (see Implementation
Risk).

This draft overlaps with the existing `RULE-001-agent-communication-conduct.md`, which takes the
opposite posture (absorb only the conservative ~8%, harness rules largely win). Per the user
directive, RULE-002 applies unlimited RCP precedence for the communication/formatting area and
should supersede RULE-001's communication item (A) on conflict. GATE-APPROVAL must reconcile the
two.

## Gap & Conflict Analysis

| RCP principle                                                                                    | Harness current state                                                                             | Classification                                                                                |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Warm-but-honest tone; no negative assumptions about ability; constructive pushback               | None (`naming-style.md` is language/UI only)                                                      | RCP adds new                                                                                  |
| Illustrate with examples, thought experiments, metaphors                                         | None                                                                                              | RCP adds new                                                                                  |
| Never curse unless user does/asks; even then sparingly                                           | None                                                                                              | RCP adds new                                                                                  |
| At most one question per response; attempt request / state assumptions before asking             | Adjacent: `feedback_agent_decision_authority` (recommend+rationale first); no question-count rule | RCP adds new                                                                                  |
| Assume a capable adult; treat them as such                                                       | None                                                                                              | RCP adds new                                                                                  |
| A prompt implying a file is present does not mean one is; check for it                           | Adjacent: "Read before Edit" agent guidance; not a rule                                           | RCP adds new                                                                                  |
| Avoid over-formatting (bold/headers/lists); minimum needed for clarity                           | None; AGENTS.md itself uses heavy bold/tables                                                     | RCP adds new                                                                                  |
| Lists/bullets only when (a) asked or (b) genuinely multifaceted                                  | None                                                                                              | RCP adds new                                                                                  |
| Bullets are at least 1-2 sentences                                                               | None; common-mistakes table uses one-line cells                                                   | RCP adds new (conversational only)                                                            |
| Simple questions answered in prose; short is fine                                                | None                                                                                              | RCP adds new                                                                                  |
| **Reports/documents/technical docs/explanations = prose, no bullets/numbered lists/excess bold** | **Conflict**: SPEC.md required sections, backlog frontmatter, contract tables mandate structure   | **Conflict → adopt RCP for conversational + narrative output; structured artifacts excepted** |
| Never use bullets when declining a task                                                          | None                                                                                              | RCP adds new                                                                                  |
| May decline a one-word answer on complex/contested topics; give nuance                           | None; rarely applicable to code work                                                              | RCP adds new                                                                                  |

Net: 12 new additions, 1 conflict (resolved by scope separation, RCP takes precedence per
directive), 0 already-covered.

## Proposed Rule Additions

The following is the concrete, RCP-aligned rule text to add. It is written to be domain-free
and to live under a new `## Communication & Formatting` section.

Tone and engagement. Use a warm tone and treat the person as a capable adult, without negative
assumptions about their judgement or ability. Push back when warranted, but constructively and
honestly. Illustrate with examples, thought experiments, or metaphors where they aid clarity.
Never curse unless the person does or asks, and then only sparingly.

Questions and ambiguity. Do not ask a question in every response. When asking, ask at most one
question per response, and first attempt the request or state your assumptions before asking for
clarification. A prompt implying a file is present does not guarantee one exists — check for it
rather than assuming.

Formatting discipline (conversational and narrative output). Default to prose. Use bullets, lists,
headers, or bold only when (a) the user asks or (b) the content is multifaceted enough that they
are essential for clarity. When bullets are used, each is at least 1-2 sentences unless the user
requests otherwise. Inside prose, fold short enumerations naturally ("includes x, y, and z")
rather than breaking into a list. For simple questions, answer in natural prose; short is fine.
For reports, PR descriptions, commit bodies, status/handoff messages, and explanations, write
prose without bullets, numbered lists, or excessive bolding unless a list or ranking is requested.

Declining. Never use bullet points when declining a task; prose softens the message.

Scope boundary (precedence-preserving). The formatting discipline above applies to free-form
narrative output addressed to a person. It does not govern machine-parsed structured artifacts
whose schema is the contract — backlog frontmatter, SPEC.md required-section headers, the rules
index / common-mistakes / comparison tables, and similar. In those artifacts, structure is
correctness; apply the prose discipline only to the free-text inside them. RCP retains
precedence per the user directive; this boundary reflects that RCP's prose rule presupposes
human-read documents, and machine-parsed contract files fall outside that premise.

## Architecture Review

### Affected Scope

The additions are mandatory, domain-free agent-conduct constraints. They affect the rules layer
(`.agents/rules/`), the rules index, and the AGENTS.md Mandatory Rules table. They do not touch
package code. They interact with `harness:scan` only insofar as the scope-boundary clause must
preserve the structural checks that scan already enforces.

### Placement Alternatives

Alt A (recommended): new rule document `.agents/rules/agent-conduct.md` with a
`## Communication & Formatting` section. Pro: these are mandatory, domain-free conduct constraints
that belong with rules; single owner doc; one row added to the AGENTS.md Mandatory Rules table and
one link in `.agents/rules/index.md`. Aligns with RULE-001 which also recommends this same file,
enabling the two drafts to converge into one doc. Con: a new rule group to maintain.

Alt B: extend `.agents/rules/naming-style.md` with a "Communication" section. Pro: no new file;
naming-style already owns style and language policy. Con: naming-style is about language and UI
styling, not conversational conduct; mixing them muddies the doc's single responsibility.

Alt C: encode the style in a RCP agent-preset under `packages/agent-preset`. Pro: matches the
existing RCP work-style preset; opt-in per profile. Con: the user directive makes RCP the
governing authority for the harness, not an opt-in profile, so preset placement would under-apply
it; also leaves default work uncovered.

Recommendation: Alt A, and merge RULE-001 item A into the same `agent-conduct.md` so there is one
owner for agent communication conduct.

### Architecture Review Checklist

- [x] Affected packages/layers listed (`.agents/rules/` + `AGENTS.md` + `rules/index.md`)
- [x] Sibling scan done — compared against `naming-style.md`, `common-mistakes.md`, RULE-001, feedback memories
- [x] At least 2 alternatives considered (placement A/B/C)
- [ ] Decision rationale finalized — pending GATE-APPROVAL placement choice and RULE-001 reconciliation

## Implementation Risk / Scope note

The decisive risk is literal application of RCP's "reports, documents, technical documentation,
and explanations are prose without bullets, numbered lists, or excessive bolding" to the whole
repo. This harness treats markdown structure as a machine-parsed contract rather than human prose
styling. SPEC.md must carry a fixed set of required section headers (enforced by the
`spec-writing-standard` skill and `harness:scan`); backlog spec-docs require `--- status / type /
tags ---` frontmatter plus a fixed section structure consumed by the gate pipeline; the
common-mistakes table, rules index table, and comparison tables convey meaning through rows and
columns. Dissolving these into prose would break `harness:scan`, make the backlog gate pipeline
unable to read frontmatter, and destroy the contract tables that humans diff quickly.

Recommended resolution — apply RCP maximally without corrupting structured artifacts by
splitting the application domain in two. The first domain is free-form narrative prose addressed to
a person: chat replies, PR descriptions, commit bodies, status/handoff reports, explanations and
rationale. RCP prose-first and minimal-formatting discipline applies here in full, including
the conflicting "reports/documents are prose" rule. The second domain is schema-defined structured
artifacts: frontmatter, SPEC.md required sections, contract tables, and the rules/AGENTS reference
docs that humans and agents route through. Structure is correctness there, so the prose mandate
does not apply; only the free-text inside those files follows the prose discipline.

This exception does not negate RCP precedence. Per the user directive, RCP wins on conflict;
the boundary is reconciled by observing that RCP's rule presupposes human-read documents while
machine-parsed contract files fall outside that premise. If the user rejects even this reading and
wants prose forced onto structured artifacts too, that breaks the harness structural invariants
(`harness:scan` pass, gate pipeline operation) and is a separate large effort requiring an explicit
GATE-APPROVAL decision. The recommendation here is the scope-separation resolution, recorded with
RCP retaining precedence.

## Affected Files

- `.agents/rules/agent-conduct.md` (new, Alt A) — or `naming-style.md` (Alt B) / `packages/agent-preset/**` (Alt C)
- `AGENTS.md` (Mandatory Rules table) — Alt A only
- `.agents/rules/index.md` (Top-Level Rules table) — Alt A only
- `.agents/spec-docs/draft/RULE-001-agent-communication-conduct.md` — reconcile/merge communication item

## Completion Criteria

- [ ] All extracted RCP communication/formatting principles are codified in the chosen doc.
- [ ] The scope-boundary clause is present so structured artifacts (frontmatter, SPEC sections, contract tables) are excepted while RCP retains stated precedence.
- [ ] No duplication or conflict with RULE-001 (merged or superseded).
- [ ] `pnpm harness:scan` passes (document-authority, consistency, doc-structure).
- [ ] AGENTS.md Mandatory Rules table + `rules/index.md` updated if Alt A.

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                                                                                                                 |
| ----- | --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | automated | `pnpm harness:scan:document-authority` | no ownership/duplication conflict for the new rule doc                                                                                |
| TC-02 | automated | `pnpm harness:scan:consistency`        | rules table ↔ index ↔ doc stay consistent                                                                                             |
| TC-03 | automated | `pnpm harness:scan` (doc-structure)    | SPEC.md required sections, backlog frontmatter, and tables still parse — confirms scope-boundary did not regress structured artifacts |
| TC-04 | manual    | review diff                            | confirm conversational/narrative prose discipline applied and structured artifacts untouched                                          |

## Tasks

- [ ] `.agents/tasks/RULE-002.md` — not created yet (create after GATE-APPROVAL passes)
- [ ] Reconcile with RULE-001 (merge communication item into one owner doc)

## Evidence Log

- 2026-06-18 — Extracted RCP communication/formatting principles from `the external reference conduct profile (not committed)` `tone_and_formatting` / `lists_and_bullets` (lines 68-91) and `evenhandedness` (lines 134-147). Head-to-head vs harness: 12 new additions, 1 conflict (prose-for-reports vs machine-parsed structured artifacts), 0 already-covered. Conflict resolved by scope separation with RCP retaining precedence per user directive. Overlaps RULE-001; reconciliation pending at GATE-APPROVAL.

- 2026-06-18 — IMPLEMENTED: consolidated into `.agents/rules/agent-conduct.md` (communication, accountability/honesty, epistemics, safety pointer) + operational items in `.agents/rules/operational.md`; precedence statement + Mandatory Rules row added to AGENTS.md + rules/index.md. `pnpm harness:scan` = all 26 passed.

# Document Standards Index

This folder owns the **artifact taxonomy** for the Robota repository: every design/architecture
document _type_, what each type must contain, and where its `{template, authoring skill, gate}` live.

It is the document-domain implementation of [`learning-loop.md` › "Contract Before
Automation"](../../rules/learning-loop.md): no generator, gate, or skill is built on a document type
until that type publishes a precise contract. This index is the router; each type's full contract is
its own owner document (a skill, a spec, or a rule), linked from the table below — never restated here.

Owning spec: `RULE-007` (`.agents/spec-docs/`). Mechanical guard: `pnpm harness:scan` →
`scripts/harness/check-document-standards-index.mjs` (keeps this index honest — see [Enforcement](#enforcement)).

## The Meta-Form — what every document-type contract must specify

A _document-type contract_ is the owner document that defines a type (e.g. `spec-writing-standard` for
`SPEC.md`). Every contract — existing or new — MUST specify all seven elements. A contract missing any
element is itself incomplete.

1. **Identity & Altitude.** What this type captures and what it explicitly does NOT (the boundary
   against adjacent types), and how durable vs. how local it is. Architecture = durable system
   structure (high altitude, hard-to-change, quality-attribute driven, kept current). Design/LLD =
   component-internal realization (local, functional, archivable). Decision record = one focused,
   immutable choice.
2. **Lifecycle & Maintenance.** When a document of this type is created or required (the trigger),
   whether it is **living** (incrementally updated to track its subject, with a drift-recovery path)
   or **immutable** (frozen once accepted, replaced by a successor — e.g. ADR supersession), and how
   it is kept current. Without this a generator has no trigger and drift cannot be defined. (Models:
   `spec-writing-standard` Initial/Incremental/Drift modes; ADR immutable-then-superseded;
   architecture-map "Update Policy".)
3. **Required Sections.** The ordered mandatory sections. A document missing any required section is
   incomplete (gate-fail). Optional sections are listed separately.
4. **Completeness Criteria.** A machine-checkable definition of "done": each required section
   non-empty above a stated threshold; no `TBD`/`TODO`/placeholder prose; plus any type-specific
   assertion (e.g. "every TC has a Test Plan row").
5. **Source Integrity.** Referenced packages, symbols, and boundaries must resolve to real artifacts.
   This delegates to the ghost-reference guard (`INFRA-DOC-GUARD-001` →
   `check-ghost-package-refs.mjs`); a contract states which references it asserts, it does not
   re-implement the check.
6. **Ownership & Non-Duplication.** Which facts live in this type vs. which belong to a neighbor type
   (each fact has exactly one owner). Cross-type references are links, never copies.
7. **Quartet pointers.** `location/naming`, `template`, `authoring skill`, `gate (harness scan/gate)`.
   Any element not yet built is named as a follow-on, not left blank.

## Artifact Taxonomy

`Status` is exactly one of: **defined** (all four quartet elements exist), **partial** (some exist,
gaps named), **gap** (type not yet defined).

| Document type            | Altitude           | Location                                                   | Status  | Template / Authoring skill / Gate                                                                                                                                                                                                                                  | Follow-on                                   |
| ------------------------ | ------------------ | ---------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Package `SPEC.md`        | package contract   | `packages/*/docs/SPEC.md`                                  | defined | — / [`spec-writing-standard`](../../skills/spec-writing-standard/SKILL.md) / `harness:scan:specs`                                                                                                                                                                  | —                                           |
| Backlog spec-doc         | work item          | `.agents/spec-docs/**`                                     | defined | [`spec-template.md`](../../templates/spec-template.md) / [`backlog-writer`](../../skills/backlog-writer/SKILL.md) / GATE-WRITE..COMPLETE + `spec-doc-frontmatter`                                                                                                  | RULE-011 (done)                             |
| ADR                      | decision record    | `.design/decisions/`                                       | defined | (template in skill) / [`architecture-decision-records`](../../skills/architecture-decision-records/SKILL.md) / `adr`                                                                                                                                               | RULE-010 (done)                             |
| Architecture-map subdoc  | system structure   | [`.agents/specs/architecture-map/*`](../architecture-map/) | defined | [template](../../templates/architecture-map-template.md) / [`architecture-map-authoring`](../../skills/architecture-map-authoring/SKILL.md) / `arch-map-paths` + `arch-map-completeness`                                                                           | RULE-008 (done)                             |
| Design / LLD             | component-internal | `packages/*/docs/design/` · cross-cutting `.agents/specs/` | defined | [template](../../templates/design-doc-template.md) / [`design-doc-authoring`](../../skills/design-doc-authoring/SKILL.md) / `design-doc`                                                                                                                           | RULE-009 (done)                             |
| Agent definition         | harness asset      | `.claude/agents/*.md`                                      | defined | (form enforced by guard + exemplar agents) / [`capability-extraction`](../../skills/capability-extraction/SKILL.md) (dispatches [`agent-skill-author`](../../../.claude/agents/agent-skill-author.md)) / `agent-def-convention` (`check-agent-def-convention.mjs`) | INFRA-036 (done)                            |
| Thin orchestration skill | harness asset      | `.agents/skills/*/SKILL.md`                                | partial | — / [`harness-governance`](../../skills/harness-governance/SKILL.md) (shape guidance) / no dedicated gate yet                                                                                                                                                      | thin-skill shape guard (deferred follow-on) |

### Status notes

- **Backlog spec-doc → defined** (`RULE-011`). The filename prefix is an **initiative/domain
  namespace** and `type` frontmatter is the **orthogonal SDLC class** ∈ 11 (e.g. `CLI-035`/`SECURITY`,
  `WORKFLOW-001`/`INFRA`) — so `INFRA-DOC-GUARD-001` with `type: BEHAVIOR` is correct, not a defect (an
  earlier note here wrongly called it one, inheriting the README's now-corrected "prefix == type"
  rule). `check-spec-doc-frontmatter.mjs` enforces frontmatter validity (`status`/`type` ∈ 11/`tags`);
  duplicate IDs are a warning.
- **ADR → defined** (`RULE-010`). Skill + template own the content; `check-adr-completeness.mjs`
  enforces the MUST sections (Status, Context, Alternatives Considered, Decision, Consequences) + a
  legal `Status`. Immutable lifecycle (superseded, never edited).
- **Architecture-map subdoc → defined** (`RULE-008`). Content policy stays in
  ([`documentation-sync.md`](../../rules/documentation-sync.md)); the **structural** contract
  (MUST spine: H1 + scope line + up-link + structure block; owner pointers as a warning) is enforced by
  `check-architecture-map-completeness.mjs`, with source integrity delegated to
  `check-architecture-map-paths.mjs`. Template + `architecture-map-authoring` skill complete the quartet.
- **Design / LLD → defined** (`RULE-009`). Owns component-internal realization. Location:
  `packages/*/docs/design/` (package-local) or `.agents/specs/` (cross-cutting), English. MUST sections
  (Context & Goal · Constraints · Internal Structure · Key Flows · Test Approach) enforced by
  `check-design-doc-completeness.mjs` over docs that exist; "when required" is process guidance in
  `design-doc-authoring` (structure-gated, existence-guided).
- **Agent definition → defined** (`INFRA-030` guard + `INFRA-036` author/skill). **Identity/Altitude:** a
  harness-asset contract (a reusable, universal/neutral subagent that holds policy), NOT a
  design/architecture document. Living; created when a recurring role is institutionalized (via
  `lesson-to-harness` → `capability-extraction`). The quartet resolves: **form/template** = the
  `check-agent-def-convention.mjs` guard + the exemplar agent files (a machine-checked shape is a stronger
  enforced form than a prose template — same pattern as the ADR row's "(template in skill)"); **authoring
  skill** = [`capability-extraction`](../../skills/capability-extraction/SKILL.md), which dispatches the
  edit-capable [`agent-skill-author`](../../../.claude/agents/agent-skill-author.md); **gate** =
  `agent-def-convention`; **location** = `.claude/agents/`. Required frontmatter
  (`name`/`description`/`tools`), read-only-vs-edit tool-scope consistency, and a closed-vocabulary
  terminal `signal:` whose token the body's output-contract enforces (declared only by signal-producing
  agents — classification is by `signal:`-field presence, never tool scope), plus skills-index
  registration, are all mechanized by the guard. The separate prose "agent-definition template" INFRA-030
  had listed as a follow-on is **retracted**: the guard supersedes it as the enforced form.
  **Neutrality is a required authored property, not a nicety.** Every agent/skill MUST be universal and
  neutral — it judges by timeless, portable principles and treats the host repo's rules/specs as _optional
  drift-check context supplied at call time_, never as baked-in policy. Its policy body MUST NOT hardcode
  project-specific package names, paths, or house conventions (a role that only works in this repo is
  mis-scoped). `capability-scout` flags non-neutral roles at decomposition, `proposal-reviewer` checks
  neutrality at the approval gate, and `agent-skill-author` must emit neutral definitions. This property is
  **semantic**, so it is review-enforced rather than fully mechanizable; a lexical warning (e.g. flagging
  `@robota-sdk/`/`packages/<name>` tokens inside an agent's policy sections) is a reasonable future
  tripwire but cannot be the sole gate (legitimate call-time examples would false-positive).
- **Thin orchestration skill → partial** (`INFRA-030`). **Identity/Altitude:** a harness-asset contract
  for a `SKILL.md` that is PURE PIPELINE — it only sequences agents and reacts to their terminal
  machine-signal, holding no domain judgement itself (that lives in the agents). NOT a design doc.
  Living. Shape guidance lives in [`harness-governance`](../../skills/harness-governance/SKILL.md); a
  dedicated shape guard is a deferred follow-on.

## Follow-on contracts (each conforms to the Meta-Form; depends on RULE-007)

Recorded here so the gaps are tracked, not silently carried. Each becomes its own gate-pipeline spec.

| Proposed item                                 | Defines                                                                                                                                                            | Status / brings to |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `RULE-008` Architecture-map contract ✅       | MUST spine (H1 + scope + up-link + structure block) + `check-architecture-map-completeness.mjs` gate + template + `architecture-map-authoring` skill               | **done** → defined |
| `RULE-009` Design/LLD type definition ✅      | location + MUST sections + "when required" policy + `check-design-doc-completeness.mjs` gate + template + `design-doc-authoring` skill                             | **done** → defined |
| `RULE-010` ADR completeness gate ✅           | `check-adr-completeness.mjs` — MUST sections + legal Status                                                                                                        | **done** → defined |
| `RULE-011` Spec-doc frontmatter convention ✅ | correct README to namespace-ID + orthogonal-`type` reality; `check-spec-doc-frontmatter.mjs` validity gate; retract the false `INFRA-DOC-GUARD-001` defect framing | **done** → defined |

## Enforcement

`scripts/harness/check-document-standards-index.mjs` (registered in `pnpm harness:scan`) asserts:

1. Every `{template, skill, gate, location}` pointer in the taxonomy resolves to a real file / script /
   skill (no ghost pointers) — reusing the `INFRA-DOC-GUARD-001` reference pattern.
2. Every document type present on disk appears in this taxonomy (no untracked type).
3. Every `gap`/`partial` row names a follow-on.

The guard's scope is exactly this index file and the pointers it names; out-of-scope findings are
filed as backlog, not folded in silently ([`harness-governance`](../../skills/harness-governance/SKILL.md)).

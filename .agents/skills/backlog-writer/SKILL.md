---
name: backlog-writer
description: Guides authoring of a new spec document. Ensures every required section is present and meets minimum quality before the item enters the gate pipeline. Does not validate gates or make approval decisions.
---

# Backlog Writer

Content authoring guide for spec documents. This skill produces a correctly structured spec document file ready for GATE-WRITE. It does not run gates, judge gate outcomes, or make implementation decisions.

## Rule Anchor

- `.agents/rules/spec-workflow.md` > HARD GATE: No Immediate Implementation
- `backlog-pipeline` skill > State Machine

## When to Use

Invoked by `backlog-pipeline` when a new spec document needs to be created. Also usable directly when drafting a spec document outside the pipeline.

## New vs Existing Items

**New item:** Create `.agents/spec-docs/draft/<ID>.md` from the schema below.

**Existing item (migration):** If a file already exists but uses an old schema (no frontmatter, no `## Test Plan`, no `## Evidence Log`):

1. Read the existing file.
2. Extract existing content and map to new sections.
3. Overwrite with the full new schema, preserving extracted content.
4. Set frontmatter `status: draft` — must pass GATE-WRITE before upgrading.
5. Existing Acceptance Criteria → map to `## Completion Criteria`, add TC-N IDs, rewrite to meet quality bar.

## Output

A `.agents/spec-docs/draft/<ID>.md` file with frontmatter `status: draft`, containing all required sections.

## Spec Document File Schema

Create or rewrite the file at `.agents/spec-docs/draft/<ID>.md` using this exact structure:

```markdown
---
status: draft
type: <one of 11 prefixes — see taxonomy below>
tags: [<tag>, <tag>]
---

# <ID>: <Title>

## Problem

<!-- symptom + reproduction condition -->

## Architecture Review

### Affected Scope

### Alternatives Considered

### Decision

### Architecture Review Checklist

- [ ] 영향 패키지/레이어 목록 작성 완료
- [ ] Sibling scan 완료 — 또는 N/A: <명시적 이유>
- [ ] 대안 최소 2개 검토 완료
- [ ] 결정 근거 문서화 완료

## Solution

## Affected Files

## Completion Criteria

<!-- TC-N prefix required on every item -->

- [ ] TC-01: <criterion>
- [ ] TC-02: <criterion>

## Test Plan

<!-- Derived from type + tags. One row per TC-N. -->

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | <type>    | <tool>          |       |
| TC-02 | <type>    | <tool>          |       |

## Tasks

- [ ] `.agents/tasks/<ID>.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
```

---

## Section-by-Section Authoring Guide

### Frontmatter

**`type`** — choose exactly one from the 11-prefix taxonomy:

| Prefix          | Nature                                           | SDLC Basis                                                             |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `SCREEN`        | UI / visual output (web, terminal, mobile)       | IEEE 830 UI Requirements; ISO/IEC 25010 Usability                      |
| `API`           | HTTP / WebSocket / RPC / MCP interface           | IEEE 830 External Interface; REST/RPC contracts                        |
| `FLOW`          | Multi-step user/agent interaction sequence       | IEEE 830 Use Case; SDLC User Story                                     |
| `BEHAVIOR`      | System-internal execution, state transitions     | IEEE 830 Functional Requirements; ISO/IEC 25010 Reliability            |
| `DATA`          | Schema, type contract, data model                | IEEE 830 Data Requirements; ISO/IEC 25010 Data model                   |
| `RULE`          | Business logic, validation, constraints          | IEEE 830 Functional Requirements; ISO/IEC 25010 Functional suitability |
| `AGREEMENT`     | Cross-system / cross-team boundary contract      | SLA; Consumer-Driven Contracts                                         |
| `INFRA`         | Build, deploy, CI/CD                             | IEEE 830 Design Constraints; Deployment Spec                           |
| `PERF`          | Performance contract (latency, throughput, cost) | ISO/IEC 25010 Performance Efficiency                                   |
| `SECURITY`      | Auth, threat boundary, data protection           | ISO/IEC 25010 Security; OWASP Secure SDLC                              |
| `OBSERVABILITY` | Logs, metrics, traces, event emission contract   | ISO/IEC 25010 Maintainability; SRE 3 Pillars                           |

**`tags`** — YAML array, pick all that apply:

_Environment / Platform (determines test tooling):_
`web` · `mobile-web` · `desktop` · `cli` · `ios` · `android`

_Protocol / Format (determines verification method):_
`rest` · `websocket` · `mcp` · `json-schema` · `typescript`

_NFR cross-cutting (triggers additional test requirements):_
`i18n` · `a11y` · `async` · `streaming` · `realtime` · `auth`

**Test strategy** — derive from the table below and write it in `## Test Plan` header or preamble:

| Type          | Tags             | Derived test strategy                       |
| ------------- | ---------------- | ------------------------------------------- |
| SCREEN        | web / desktop    | Playwright E2E                              |
| SCREEN        | mobile-web       | Playwright E2E (mobile viewport)            |
| SCREEN        | cli              | Process spawn + stdout assertion            |
| SCREEN        | i18n             | Locale rendering test                       |
| SCREEN        | a11y             | axe-core accessibility test                 |
| API           | rest             | HTTP integration test                       |
| API           | websocket        | WebSocket integration test                  |
| API           | mcp              | MCP protocol integration test               |
| FLOW          | web / mobile-web | Playwright E2E scenario                     |
| FLOW          | cli              | Process integration test                    |
| FLOW          | agent            | Agent simulation E2E                        |
| BEHAVIOR      | async            | Async state assertion integration test      |
| BEHAVIOR      | streaming        | Stream output integration test              |
| DATA          | json-schema      | Zod / JSON Schema validation test           |
| DATA          | typescript       | vitest-expect-type / tsd type test          |
| RULE          | _(any)_          | Unit test                                   |
| AGREEMENT     | _(any)_          | Consumer-driven contract test               |
| INFRA         | ci               | CI pipeline smoke test                      |
| PERF          | _(any)_          | Benchmark test (timing assertions)          |
| SECURITY      | auth             | Auth integration + permission boundary test |
| OBSERVABILITY | _(any)_          | Log / event emission assertion test         |

Multiple tags → list all derived strategies, one per line.

---

### `## Problem`

**Minimum required content:**

1. Concrete symptom — what command, code path, or output is wrong
2. Reproduction condition — when and where it occurs

**Rejected (GATE-WRITE will FAIL):** "TBD", vague single sentence, "It doesn't work correctly"

---

### `## Architecture Review`

#### `### Affected Scope`

List every package, layer, and file that changes. Format: `packages/<name>` / `<file path>`.

#### `### Alternatives Considered`

Minimum 2 alternatives. For each: one-line description + Pro + Con.

#### `### Decision`

Which alternative was chosen and why. Reference the trade-off.

#### `### Architecture Review Checklist`

All 4 items must be `[x]` before GATE-WRITE can pass:

- Normal: `- [x] 영향 패키지/레이어 목록 작성 완료`
- Sibling scan N/A: `- [x] Sibling scan 완료 — N/A: not a CLI command family`
- Sibling scan done: `- [x] Sibling scan 완료 — agent-cli {chat,print,init} 전부 확인`

Never leave `[ ]`. Unchecked = work not done.

---

### `## Completion Criteria`

**Rules:**

- Every item MUST have a `TC-N` prefix (TC-01, TC-02, …) — no exceptions.
- Write BEFORE implementation begins.
- Minimum 1 criterion per distinct feature or sub-item.
- Two accepted forms:
  1. **Command form** (preferred): `TC-01: <command> → exits <code> / outputs <string>`
  2. **Observable behavior form** (visual/terminal): exact string, ANSI code, specific observable output

**Rejected (GATE-WRITE will FAIL):**

- Item without TC-N prefix
- "Works correctly", "No errors", "Feature is implemented"
- "Displays correctly" (too vague)

---

### `## Test Plan`

**Rules:**

- One row per TC-N item in `## Completion Criteria`.
- Derive Test Type + Tool from the type + tags derivation table.
- If a TC-N cannot be covered by automated test: write the reason in Notes and mark `manual`.

**Rejected (GATE-WRITE will FAIL):**

- Missing row for any TC-N
- "TBD" in Test Type or Tool
- No Notes entry when Tool is "manual"

---

### `## Tasks`

Leave placeholder at draft time. Populated by `backlog-gate-guard` at GATE-IMPLEMENT.

---

### `## Evidence Log`

Leave empty at draft time. All entries written by `backlog-gate-guard`. Never write manually.

## What This Skill Does NOT Do

- Run any gate or make PASS/FAIL decisions → that is `backlog-gate-guard`
- Update frontmatter status → that is `backlog-pipeline`
- Write Evidence Log entries → that is `backlog-gate-guard`
- Decide which test type to use beyond the derivation table

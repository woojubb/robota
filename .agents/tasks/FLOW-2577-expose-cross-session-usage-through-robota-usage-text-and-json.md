---
title: 'FLOW-2577: Expose cross-session usage through robota usage text and JSON'
issue: https://github.com/woojubb/robota/issues/2577
status: todo
created: 2026-09-06
priority: high
urgency: soon
area: agent-cli, agent-session-analytics, agent-interface-analytics
depends_on: [OBSERVABILITY-2577]
---

# FLOW-2577: Expose cross-session usage through robota usage text and JSON

## Objective

Add a first-class `robota usage` command for local cross-session history while preserving
`robota session analyze --usage` as the per-session diagnostic flow. Provide readable terminal output
and a stable machine-readable projection whose schema is versioned independently from internal types and
session persistence.

## Existing Evidence

- No `robota usage` command exists; `/cost` and session analysis cover only the current/selected session.
- CLI session analysis already discovers user/project stores and has an established duplicate-session
  precedence that the shared report can reuse.
- Agent consumers will depend on `--format json`; directly serializing an internal interface would turn
  ordinary refactors into silent public-contract breaks.

## Plan

- [ ] Add command parsing and help for `robota usage`, `--period 7d|30d`, `--timezone <IANA>`, and
      `--format text|json` with documented defaults and explicit invalid-input errors.
- [ ] Keep user/project store discovery, enumeration, and snapshot I/O in the CLI host; pass one
      immutable snapshot to the OBSERVABILITY-2577 pure reducer without CLI-owned aggregation or dedupe.
- [ ] Render compact text totals, daily trend, model/surface/source/activity breakdowns, cost confidence,
      partial-day state, and coverage warnings.
- [ ] Publish JSON with top-level `schemaVersion: 1`, generated time, resolved interval/timezone,
      summary, buckets, breakdowns, contributing sessions, and coverage.
- [ ] Document compatibility rules: additive fields may remain v1; removals, renames, type changes, or
      semantic changes require a new schema version and migration note.

## Constraints

- Empty valid history is exit 0 with an explicit empty state.
- Invalid period/timezone, store enumeration failure, or inability to produce any trustworthy report is
  non-zero with the standard CLI error contract.
- Partial coverage is exit 0 only when warnings identify what was omitted.
- Text and JSON are projections of the same report instance and must not scan stores independently.
- Cost output is marked estimated/unknown and “not an invoice” when not provider-authoritative.

## Test Plan

- Parser/help unit tests for defaults, accepted flags, and invalid period/timezone/format values.
- Process integration tests asserting text/JSON stdout, stderr, and exit codes against deterministic
  isolated session stores.
- JSON schema/compatibility tests for `schemaVersion: 1` and privacy-safe fields.
- Golden fixture comparison against the shared report, including empty and partial-coverage output.
- Affected CLI/analytics builds and governing `docs/SPEC.md` conformance checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1 — readable 7-day report

Prerequisites: build the CLI and point an isolated HOME/project at the canonical AGREEMENT-2577 session
fixture.
Run `robota usage --period 7d`.

Expected: exit 0; text shows the resolved date range/timezone, sessions, turns, prompt/completion/total
tokens, cost confidence, complete daily rows, model/surface/source/tool/skill/plugin breakdowns, current
partial-day marker, and any coverage warning. Cleanup: remove only the isolated fixture directories.
Evidence: pending; record stdout/stderr and exit code after implementation.

### Scenario 2 — stable JSON and errors

With the same fixture, run `robota usage --period 30d --timezone UTC --format json`, validate the full
output against the v1 schema, then run once with an invalid timezone.

Expected: the first run exits 0 and begins with `schemaVersion: 1`; it includes exact bounds, zero-day
buckets, `unknown` legacy attribution, and no stored content. The invalid run exits non-zero with the
standard CLI error shape. Cleanup and evidence are the same as Scenario 1.

---
title: 'AGREEMENT-008: coordinate the first bulk child-Issue absorption wave'
issue: https://github.com/woojubb/robota/issues/2079
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: issue-to-task migration across command, transport, host, and refactor owners
depends_on: [RULE-023]
children:
  [
    REFACTOR-027,
    REFACTOR-028,
    TRANS-011,
    TRANS-012,
    TRANS-013,
    TRANS-014,
    TRANS-015,
    CMD-014,
    CMD-015,
    CMD-016,
    CMD-017,
    CMD-018,
    CMD-019,
    HOST-015,
    HOST-016,
    HOST-017,
    HOST-018,
  ]
---

# AGREEMENT-008: coordinate the first bulk child-Issue absorption wave

## Objective

Replace 17 redundant executable Issue queue entries from canonical tracker
[issue #2079](https://github.com/woojubb/robota/issues/2079) with exact Task owners in one bounded
migration wave. Preserve source Issue history, native hierarchy and dependency edges, priority in Task
frontmatter, and the fact that none of the product outcomes has been delivered yet.

## Children

- [ ] REFACTOR-027 — todo — `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`
- [ ] REFACTOR-028 — todo — `.agents/tasks/REFACTOR-028-finish-removing-the-ghost-workflow-subsystem-from-agent-core.md`
- [ ] TRANS-011 — todo — `.agents/tasks/TRANS-011-the-transport-registry-erases-heterogeneous-exact-session-capabilities-into-one-.md`
- [ ] TRANS-012 — todo — `.agents/tasks/TRANS-012-coordinate-exact-session-capability-transport-bindings.md`
- [ ] TRANS-013 — todo — `.agents/tasks/TRANS-013-bind-http-and-mcp-to-their-exact-session-ports.md`
- [ ] TRANS-014 — todo — `.agents/tasks/TRANS-014-bind-ws-protocol-and-webrtc-adapters-to-exact-session-ports.md`
- [ ] TRANS-015 — todo — `.agents/tasks/TRANS-015-remove-iinteractive-session-from-production-transport-seams.md`
- [ ] CMD-014 — todo — `.agents/tasks/CMD-014-coordinate-command-features-as-owner-aligned-vertical-slices.md`
- [ ] CMD-015 — todo — `.agents/tasks/CMD-015-move-execution-background-and-schedule-commands-to-their-owners.md`
- [ ] CMD-016 — todo — `.agents/tasks/CMD-016-move-session-history-compact-and-rewind-commands-to-their-owners.md`
- [ ] CMD-017 — todo — `.agents/tasks/CMD-017-move-provider-settings-and-plugin-commands-to-their-owners.md`
- [ ] CMD-018 — todo — `.agents/tasks/CMD-018-move-help-language-and-permission-commands-to-the-product-shell.md`
- [ ] CMD-019 — todo — `.agents/tasks/CMD-019-expose-coding-commands-as-leaf-entries-and-remove-umbrella-consumers.md`
- [ ] HOST-015 — todo — `.agents/tasks/HOST-015-coordinate-headless-and-programmatic-host-extraction.md`
- [ ] HOST-016 — todo — `.agents/tasks/HOST-016-extract-the-headless-stdio-host-package.md`
- [ ] HOST-017 — todo — `.agents/tasks/HOST-017-extract-the-programmatic-in-process-host-package.md`
- [ ] HOST-018 — todo — `.agents/tasks/HOST-018-migrate-consumers-and-remove-the-agent-transport-umbrella.md`

## Plan

- [ ] TC-01 — Land all 17 exact child Tasks atomically and preserve each source Issue URL, priority, and
      implementation outcome.
- [ ] TC-02 — Freeze the combined 22-row C1 mutation set: these 17 records plus AGREEMENT-007 and its four
      command children.
- [ ] TC-03 — Append one exact Task marker per row, remove only P-priority labels, and close every row as
      `NOT_PLANNED` in dependency-safe order.
- [ ] TC-04 — Preserve all native parent, sub-issue, blocked-by, blocking, assignee, and historical URL
      evidence through the migration.
- [ ] TC-05 — Reconcile all 22 rows and the complete GitHub Issue population in one post-write audit.

## Test Plan

- Validate Task/spec projections and source Issue identities across the complete 19-file prelude.
- Validate the exact C1 manifest and all 22 readable Task paths before the first GitHub write.
- Perform one complete post-write read-back covering bodies, marker authors, labels, states, reasons, and
  relationships for all 22 rows.
- Run affected repository scans once after the full C1 evidence update, not once per row.

## User Execution Test Scenarios

Not applicable — this AGREEMENT migrates administrative ownership records and does not change runnable
product behavior. Each child owns its future executable scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The agreement changes Task and GitHub queue ownership only; it introduces no public API, CLI,
TUI, runtime, or end-user interaction.

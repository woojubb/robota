---
title: 'AGREEMENT-2670: Complete CLI and TUI usability accessibility and diagnostics'
issue: https://github.com/woojubb/robota/issues/2670
status: todo
created: 2026-09-14
priority: high
urgency: soon
area: CLI and terminal UI product surfaces
children:
  [
    OBSERVABILITY-1991,
    SCREEN-1992,
    SCREEN-1993,
    SCREEN-2002,
    BEHAVIOR-2003,
    FLOW-2006,
    BEHAVIOR-2437,
    SCREEN-2442,
    SCREEN-2670,
  ]
depends_on: [STRUCT-012, REFACTOR-025]
---

# AGREEMENT-2670: Complete CLI and TUI usability accessibility and diagnostics

## Objective

Deliver every unchecked source outcome consolidated into Issue #2670. Reuse and finish the existing
STRUCT-012 and REFACTOR-025 records for Issue #2197 and Issue #2054 instead of creating duplicates, and
retain the other nine independently verifiable causes as child Tasks.

The source register is exhaustive:

| Source      | Owner              | Cause and completion boundary                                     |
| ----------- | ------------------ | ----------------------------------------------------------------- |
| Issue #1991 | OBSERVABILITY-1991 | pre-session diagnostics, provenance and bounded repair            |
| Issue #1992 | SCREEN-1992        | unattended interval detection and recap/activity projection       |
| Issue #1993 | SCREEN-1993        | persisted prompt/transcript query and interactive search          |
| Issue #2002 | SCREEN-2002        | runtime theme registry, accessible palettes and reduced motion    |
| Issue #2003 | BEHAVIOR-2003      | contextual keybinding grammar, validation and hot reload          |
| Issue #2006 | FLOW-2006          | allowlisted deep-link launch intent with inert prompt prefill     |
| Issue #2054 | REFACTOR-025       | narrow TUI ports and responsibility-based coordinator extraction  |
| Issue #2197 | STRUCT-012         | transport substrate consolidation and presentation package rename |
| Issue #2437 | BEHAVIOR-2437      | first-class Git status, diff and confirmed commit commands        |
| Issue #2773 | SCREEN-2442        | real Terminal.app Korean IME evidence and policy decision         |
| Issue #2670 | SCREEN-2670        | asynchronous screen-reader pre-write park and ordered frame queue |

The five SCREEN Tasks remain separate because they have different causes, owners and evidence:
attention state, stored-history query, palette configuration, OS/IME integration and stdout scheduling.

## Plan

- [ ] Complete STRUCT-012 S3-S5 so subsequent TUI work targets the final package names.
- [x] Reconcile REFACTOR-025 with Issue #2054, remove the obsolete deleted-scan requirement, and complete its narrow-port and coordinator outcomes.
- [ ] Execute each child Task through its own tests and user-visible scenario while preserving the complete source checklist.
- [ ] Verify all child and prerequisite records are terminal and their delivery commits are ancestors of origin/develop.
- [ ] Update the Issue #2670 delivery map and close the umbrella only after all eleven source outcomes are evidenced.

## Children

- [x] OBSERVABILITY-1991 — done — `.agents/tasks/completed/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`
- [x] SCREEN-1992 — done — `.agents/tasks/completed/SCREEN-1992-recap-unattended-session-and-background-activity.md`
- [x] SCREEN-1993 — done — `.agents/tasks/completed/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`
- [x] SCREEN-2002 — done — `.agents/tasks/completed/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`
- [x] BEHAVIOR-2003 — done — `.agents/tasks/completed/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`
- [x] FLOW-2006 — done — `.agents/tasks/completed/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`
- [x] BEHAVIOR-2437 — done — `.agents/tasks/completed/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`
- [x] SCREEN-2442 — done — `.agents/tasks/completed/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`
- [x] SCREEN-2670 — done — `.agents/tasks/completed/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`

## Test Plan

Audit each source checklist against its owning Task/spec, execute every child's focused and user-surface
verification, and confirm STRUCT-012 plus REFACTOR-025 have truthful terminal records. The final audit
must prove all eleven rows, not infer completion from Issue state or a green aggregate scan.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Agreement only coordinates independently user-verifiable child capabilities; it does
not add a separate product surface beyond the scenarios owned and executed by those children.

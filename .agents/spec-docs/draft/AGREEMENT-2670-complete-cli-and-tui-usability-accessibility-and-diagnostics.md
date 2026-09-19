---
status: draft
type: AGREEMENT
tags: [cli, tui, accessibility]
lane: L2
---

# AGREEMENT-2670: Complete CLI and TUI usability, accessibility, and diagnostics

Paired with `.agents/tasks/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md`. Arising from [issue #2670](https://github.com/woojubb/robota/issues/2670).

## Problem

Issue #2670 consolidates eleven unfinished CLI/TUI outcomes. On current `origin/develop`, running the
CLI still exposes no complete doctor/checkup, unattended recap, history search, runtime theme picker,
configurable keybindings, deep-link launch surface or first-class Git command family. The terminal UI
packages still carry transport names and broad concrete runtime dependencies; real Korean IME evidence
is missing on Terminal.app/iTerm2; and screen-reader mode has no pre-write cursor park.

Closing only the retained screen-reader defect would discard ten explicitly transferred outcomes.
Conversely, implementing all eleven as one unstructured patch would make independent completion claims
impossible to verify. Two source outcomes already have active owners: STRUCT-012 for Issue #2197 and
REFACTOR-025 for Issue #2054. They must be finished and reused, not duplicated.

## Prior Art Research

The reference behavior was re-read on 2026-09-14 from the current product documentation rather than
copied from the August issue snapshots:

- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode) now documents
  focus-aware session recap, scoped reverse history search, native transcript scrollback and explicit
  accept/cancel behavior.
- [Claude Code keybindings](https://code.claude.com/docs/en/keybindings) documents a hot-reloaded,
  context/action JSON model with schema, null unbinding and picker/search contexts.
- [Claude Code terminal configuration](https://code.claude.com/docs/en/terminal-config) documents
  light/dark/daltonized and custom/plugin themes; [settings](https://code.claude.com/docs/en/configuration)
  keeps reduced motion independent.
- [Claude Code deep links](https://code.claude.com/docs/en/deep-links) confirms that a link selects a
  directory/repository and pre-fills an inert prompt; it never submits automatically.
- [Debug configuration](https://code.claude.com/docs/en/debug-your-config) and
  [troubleshooting](https://code.claude.com/docs/en/troubleshooting) confirm `/doctor` as the combined
  installation/settings/MCP/context diagnostic path.
- [Agent view](https://code.claude.com/docs/en/agent-view) confirms separate status, concise activity,
  latest-output peek and scheduled countdown concerns.

Robota's provider-neutral and local-first constraints adapt these references: deterministic structured
events own recap correctness; model-written text is optional decoration, diagnostics reuse runtime
resolvers and never reveal credentials, and deep links pass through workspace trust.

## Architecture Review

### Affected Scope

- `packages/agent-cli`, `packages/agent-command`, `packages/agent-framework`
- `packages/agent-interface-session`, `packages/agent-interface-execution`
- current `packages/agent-transport`, `packages/agent-ui-terminal`, `packages/agent-ui-web` and
  their final renamed owners
- `apps/agent-app` plus live package/build/CI/documentation references affected by STRUCT-012
- the existing STRUCT-012 and REFACTOR-025 Task/spec records and nine new child pairs

### Alternatives Considered

1. Fix only Issue #2670's original screen-reader defect.
   - Pro: smallest immediate patch.
   - Con: violates the umbrella register by discarding ten inherited outcomes.
2. Treat all eleven rows as one implementation Task.
   - Pro: one branch and one final delivery surface.
   - Con: unrelated causes and evidence collapse into an unverifiable all-or-nothing claim.
3. Keep one parent Agreement, reuse the two existing owners and execute nine cause-aligned children.
   - Pro: preserves every source criterion, avoids duplicate Tasks and supports independent verification.
   - Con: requires explicit parent projections and sequential coordination in the single checkout.

### Decision

Choose alternative 3. The five SCREEN children stay separate because their causes are attention-state
projection, persisted-history querying, runtime palette configuration, OS/IME integration and stdout
scheduling. STRUCT-012 is a path/ownership prerequisite for changes in the renamed terminal package;
REFACTOR-025 is declared only where App/channel ownership overlaps. CLI-only diagnostics, deep links and
Git commands have no false dependency on the coordinator refactor.

Independent finding-depth and proposal review on 2026-09-14 returned `ROOT-CAUSE ALIGNED` and
`REVIEW VERDICT: ENDORSE` after the source-to-task and dependency matrices were made explicit.
Reachability is preserved by child user scenarios; capability preservation is checked against existing
diagnose, native scrollback, background projection, semantic palette and IME suites. The adversarial pass
rejects both the narrow one-defect closure and evidence-by-aggregate-scan.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing command, session, execution, terminal UI and desktop owners were inspected; shared boundaries are dependencies, not merged causes
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: existing CLI, command, session/execution interfaces and terminal/desktop
      presentation owners receive the behavior; STRUCT-012 performs the already-approved family rename.

## Fallback & Degradation Declaration

None

## Solution

1. Complete STRUCT-012 S3-S5 and then reconcile REFACTOR-025 to Issue #2054 without restoring its deleted
   global file-size gate. This establishes final package names and narrow UI capability boundaries.
2. Scaffold and gate each new child pair only when it enters implementation. Preserve the source issue's
   full checklist and the parent matrix in every child recommendation.
3. Execute children serially in the shared checkout, batching only shared settings/input infrastructure
   that is directly required by the active child. No worktree is created.
4. Run each child's focused engineering tests and product scenario, archive it truthfully, and update both
   parent projections in the same commit.
5. After all eleven source outcomes are delivered on `origin/develop`, update Issue #2670's delivery map,
   close it and post delivery evidence to each consolidated source issue.

## Affected Files

- `.agents/tasks/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md`
- `.agents/tasks/{OBSERVABILITY-1991,SCREEN-1992,SCREEN-1993,SCREEN-2002,BEHAVIOR-2003,FLOW-2006,BEHAVIOR-2437,SCREEN-2442,SCREEN-2670}-*.md`
- `.agents/tasks/STRUCT-012-*.md`, `.agents/spec-docs/active/STRUCT-012-*.md`
- `.agents/tasks/REFACTOR-025-*.md` and its paired spec when reconciled
- child-owned package, app, test and SPEC paths declared by each later child plan

## Completion Criteria

- [ ] TC-01: OBSERVABILITY-1991 archives with a built `doctor`/`checkup` and `/doctor` scenario covering provenance, all required checks, bounded repair, redaction and pre-session reachability.
- [ ] TC-02: SCREEN-1992 archives with attention-return recap, normalized background states, peek and a live countdown verified through structured events and PTY output.
- [ ] TC-03: SCREEN-1993 archives with scoped newest-first deduplicated reverse search, progressive acceptance, exact cancel restoration and native full-transcript scrollback evidence.
- [ ] TC-04: SCREEN-2002 archives with built-in light/dark/daltonized themes, user/plugin themes, live picker, independent syntax highlighting and reduced motion, with no color-only information.
- [ ] TC-05: BEHAVIOR-2003 archives with schema-backed contextual bindings, hot reload, modifiers, uppercase rules, chords, null unbinding, reserved/conflict diagnostics and derived hints.
- [ ] TC-06: FLOW-2006 archives with registered allowlisted deep links that select a trusted cwd/repo and prefill without submitting or injecting configuration.
- [x] TC-07: REFACTOR-025 archives after Issue #2054's narrow TUI ports and responsibility extractions pass characterization, type-boundary and functional tests; the obsolete deleted scan is explicitly removed from scope.
- [ ] TC-08: STRUCT-012 archives after S3-S5 consolidate protocol into the parent, rename presentation packages, delete the old protocol package and pass all declared conformance/build tests.
- [ ] TC-09: BEHAVIOR-2437 archives with argument-safe `/status`, `/diff` and confirmed staged-only `/commit` behavior in a real temporary repository.
- [ ] TC-10: SCREEN-2442 archives with recorded Terminal.app/iTerm2 Korean IME versions and all four real-cell outcomes, the resulting Apple Terminal policy decision and green regression suites.
- [ ] TC-11: SCREEN-2670 archives with a bounded asynchronous pre-write park queue whose timing, FIFO frame integrity, errors/backpressure, teardown and IME cursor order are verified RED→GREEN and in PTY.
- [ ] TC-12: all eleven owner rows are terminal with exact delivery commits ancestral to `origin/develop`; Issue #2670 and each source issue contain read-back delivery evidence before the umbrella closes.

## Test Plan

| TC-ID | Test Type                        | Tool / Approach                                          | Notes                                             |
| ----- | -------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| TC-01 | Integration/CLI                  | OBSERVABILITY-1991 focused tests + built binary scenario | Broken isolated configuration and bounded repairs |
| TC-02 | Component/PTY                    | SCREEN-1992 fake timers + deterministic TUI scenario     | Attention interval and all background states      |
| TC-03 | Unit/PTY                         | SCREEN-1993 store query, component and PTY suites        | More than 100 prompts across projects             |
| TC-04 | Unit/PTY                         | SCREEN-2002 registry/component and live picker scenario  | Palette, syntax and motion axes                   |
| TC-05 | Unit/PTY                         | BEHAVIOR-2003 grammar/context and hot-reload scenario    | File changes during a live session                |
| TC-06 | Contract/E2E                     | FLOW-2006 codec, trust and desktop/CLI launch tests      | Zero provider calls before Enter                  |
| TC-07 | Characterization/Type/Functional | REFACTOR-025 declared focused suites                     | Existing behavior plus narrowed capabilities      |
| TC-08 | Build/Conformance                | STRUCT-012 TC-01 through TC-13                           | Preserve its accepted staged design and evidence  |
| TC-09 | Integration/CLI                  | BEHAVIOR-2437 temporary Git repository scenario          | Refusal and accepted staged-only commit           |
| TC-10 | Manual/PTY                       | SCREEN-2442 four real macOS cells + existing suites      | Real Korean IME evidence, not env simulation      |
| TC-11 | Unit/PTY                         | SCREEN-2670 fake timers, stream and PTY byte capture     | RED unwrapped, GREEN queued                       |
| TC-12 | Remote audit                     | GitHub PR/check/issue readback and Git ancestry          | No aggregate scan substitutes for row evidence    |

## User Execution Test Scenarios

Not applicable — this parent only coordinates child capabilities whose own runnable scenarios provide
the product evidence; it adds no additional command, SDK or presentation behavior.

Recorded as the rule's required choice rather than skipped.

## Tasks

The exact paired parent is `.agents/tasks/AGREEMENT-2670-complete-cli-and-tui-usability-accessibility-and-diagnostics.md`.

- [x] OBSERVABILITY-1991 — done — `.agents/tasks/completed/OBSERVABILITY-1991-diagnose-cli-configuration-and-runtime-readiness-before-a-session-starts.md`
- [x] SCREEN-1992 — done — `.agents/tasks/completed/SCREEN-1992-recap-unattended-session-and-background-activity.md`
- [ ] SCREEN-1993 — todo — `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`
- [ ] SCREEN-2002 — todo — `.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`
- [x] BEHAVIOR-2003 — done — `.agents/tasks/completed/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`
- [ ] FLOW-2006 — todo — `.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`
- [ ] BEHAVIOR-2437 — todo — `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`
- [ ] SCREEN-2442 — todo — `.agents/tasks/SCREEN-2442-validate-korean-ime-cursor-positioning-on-macos-terminals.md`
- [ ] SCREEN-2670 — todo — `.agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`

## Evidence Log

2026-09-14 recommendation evidence: independent depth/proposal review first returned REVISE because
issue-shaped SCREEN Tasks and dependency scopes were not distinguished. After the cause matrix and
per-Task dependencies were made explicit, the reviewer returned `DEPTH VERDICT: ROOT-CAUSE ALIGNED`,
`REVIEW VERDICT: ENDORSE`, with no remaining blocker. Read-only audits also established that `/diagnose`,
background projections, full native scrollback, semantic palette and most CLI-062 mechanics are partial
foundations rather than proof of the transferred outcomes.

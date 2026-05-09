# Repository Situational Awareness for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P1 - baseline context display feature for helping users understand where Robota is operating.

## Request

Make `agent-cli` show the current operating context clearly without turning context display into
repo scanning, package-manager guessing, command discovery, harness scoring, or repo workflow
inference.

The feature must answer:

> Where is Robota currently operating, what session-known state is visible, and what source produced
> each displayed context item?

## Non-Negotiable Product Principles

- **Repo reads stay minimal and session-directed.** Displaying context must not create Robota files,
  modify repo files, scan the repo, guess package manager setup, or infer a harness contract.
- **Context source must be clear.** Each displayed item should identify whether it came from git
  state, cwd, active session state, or explicit user reference.
- **Command discovery is explicit-only.** Passive context display must not infer "the test command",
  "the build command", or any canonical harness command.
- **Repo independence remains mandatory.** The repository must work the same without Robota.

## Context Scope

Allowed baseline context:

- repo root;
- current branch;
- dirty status summary;
- cwd;
- explicitly opened or referenced docs;
- active background task workspace context.

Restricted context:

- no command candidate ranking;
- no readiness scoring;
- no CI-to-local command mapping;
- no package manager guessing;
- no visible workspace file enumeration;
- no automatic setup profile generation;
- no repo-side manifest or config requirement.

## Expected Outcomes

- Users can quickly understand where Robota is operating before running commands or switching work.
- Displayed context becomes trustworthy because every item has a visible source.
- Session-known context helps orientation without becoming repo scanning, command discovery,
  readiness scoring, or hidden repo workflow inference.
- Repo independence remains clear because context display does not create Robota files or require
  repo-side configuration.

## Architecture Ownership Rule

`agent-cli` owns only TUI display of repository context.

Lower owners must be established first:

- `agent-sdk`: current context projection APIs, context provenance fields, and minimal read
  boundaries.
- `agent-command-*`: user-visible context/status commands backed by SDK contracts.

Do not implement repo scanning policy, package-manager guessing, command inference, readiness
scoring, or context provenance rules inside `agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Define the repo context projection model.
2. Define allowed session-known context sources and provenance labels.
3. Define forbidden baseline inference behavior.
4. Update `agent-sdk`, `agent-command-*`, and `agent-cli` SPEC files.
5. Add tests proving context display does not create repo files, scan workspace files, guess package
   managers, or infer commands.

## Acceptance Criteria

- [x] The context view shows repo root, branch, dirty status, cwd, explicitly referenced docs, and
      active background workspace context where available.
- [x] Each context item has a clear source/provenance.
- [x] Context display does not infer canonical commands, readiness scores, package manager setup, or
      visible workspace files.
- [x] Context display does not write repo files.
- [x] CLI UI depends on SDK context projections rather than owning repo scanning policy.

## Test Plan

- Add SDK tests for repo root, branch, dirty status, cwd, explicit document-reference projections,
  and active background workspace context.
- Add provenance tests proving each displayed context item includes a source label.
- Add negative tests proving context projection does not infer canonical commands, readiness scores,
  CI mappings, package manager setup, visible workspace files, or setup profiles.
- Add tests proving context display does not create or modify repo files.
- Add CLI rendering tests after SDK projections exist.

## User Test Scenarios

Not applicable. This backlog produced a repository situational awareness contract document and did
not deliver runnable Robota product behavior. Product-surface scenarios must be added by follow-up
implementation PRs that expose repository context through CLI/TUI/SDK behavior.

## Process Verification Evidence

### Verification: Passive Repository Context Boundaries Are Documented

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "current `cwd`|repository root|dirty status summary|explicitly referenced documents|command discovery|must not list file paths|write repository-local state" .agents/specs/repository-situational-awareness.md
  ```

- Expected result: The command prints allowed context items, command inference prohibition,
  file-listing restriction, and repository-write prohibition.
- Evidence: Executed as process verification for the contract document. SDK projection APIs and CLI
  rendering remain follow-up implementation work, where product-surface user scenarios must be
  added.

## Verification Plan

- `pnpm harness:scan`
- Add SDK tests for repo context projection and provenance.
- Add tests proving no repo files are written.
- Add tests proving no package-manager guessing or workspace-file enumeration occurs.
- Add CLI rendering tests after SDK contracts exist.

## Result

Completed by adding `.agents/specs/repository-situational-awareness.md` and linking package
ownership from `agent-sdk`, `agent-cli`, `agent-command-context`, and `agent-command-statusline`
SPEC files.

- The contract defines passive context item fields, allowed provenance sources, bounded read rules,
  and command/automation boundaries.
- Dirty status is limited to summary display by default, without visible workspace file
  enumeration.
- SDK projection APIs, host adapter tests, command formatting, and CLI rendering tests remain
  follow-up implementation work.

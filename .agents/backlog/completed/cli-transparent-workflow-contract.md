# Transparent Workflow Contract for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - foundational contract that every transparent workflow feature must satisfy before UI work.

## Request

Define the cross-cutting transparency contract for `agent-cli` workflow features.

The contract must make Robota predictable when the user is trying to do something: actions, state
changes, memory use, and UI transitions must have visible provenance and simple rules.

## Non-Negotiable Product Principles

- **Transparency is part of correctness.** A feature is incomplete if the user cannot tell what
  Robota is doing, why a state changed, what source produced a shown item, or how to inspect/remove
  remembered local state.
- **Every action has visible provenance.** The UI/API must distinguish user-entered commands,
  assistant suggestions accepted by the user, active session state, user-local UI preferences, and
  explicitly referenced repo-owned documents. User-local preferences must not be a source for
  command execution.
- **Hidden automation is not a baseline feature.** If Robota suggests or infers something, it must
  be labeled as a suggestion and require explicit user acceptance before execution.
- **Repo independence remains mandatory.** The contract must not require Robota files, manifests,
  hooks, scripts, package dependencies, or CI changes in the user repository.

## Contract Scope

The contract must define:

- action provenance fields;
- named state transitions;
- memory inspection and deletion rules;
- UI disclosure requirements;
- boundaries between user-directed execution and explicit advisory analysis;
- the rule that remembered commands are not a baseline command source.

## Required Contract Rules

1. **Action transparency**
   - Before or while running work, show what will run or is running: command or task label, origin,
     cwd, selected environment summary, start time, timeout/cancellation policy, and whether it is
     foreground or background.
   - For command execution, origin must be either user input or an accepted assistant suggestion.
   - For display and navigation, origin may also include active session state, user-local UI
     preference, or explicit repo document reference.
   - User-local UI preferences may affect display and navigation, but must not execute commands.

2. **State transparency**
   - Background entries must show type, owner/source, status, selected state, elapsed time, latest
     output summary, input-needed state, cancelability, and terminal result.
   - State transitions must be small and named: queued, running, waiting-for-input, completed,
     failed, cancelled, or archived.

3. **Memory transparency**
   - Local memory must be visible through an inspection command or TUI panel.
   - Each remembered item must show key, value summary, scope, source, last-used time, storage
     location, and deletion/disable action.
   - Robota must not silently convert repeated behavior into a persistent preference.
   - Remembered commands are not a baseline command source and must not be reused for execution.

4. **Interface transparency**
   - The UI should expose the smallest complete set of facts needed to act confidently.
   - Internal implementation details can remain hidden, but user-impacting state, actions, and
     memory must be inspectable.

## Expected Outcomes

- Users can predict why Robota is showing or doing something because action provenance, state, and
  memory visibility have common labels.
- Process execution, background work, local memory, and repo context features share one vocabulary
  instead of inventing separate UI rules.
- Hidden automation becomes easier to reject during review because every user-impacting action must
  declare its source.
- `agent-cli` remains a renderer of transparent state while SDK/runtime own the contracts and
  lifecycle rules.

## Architecture Ownership Rule

`agent-cli` owns only TUI presentation of the transparency contract.

Lower owners must be established first:

- `agent-runtime`: named lifecycle states and transition rules for processes and tasks.
- `agent-sdk`: action provenance types, projected state models, and local memory inspection APIs.
- `agent-command-*`: user-visible commands that expose status and memory inspection through SDK
  contracts.

Do not define action provenance, lifecycle state names, memory storage shape, or retention policy
inside `agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Add or update the cross-cutting spec for transparent workflow primitives.
2. Define action provenance as a typed contract.
3. Define lifecycle state names and valid transitions.
4. Define memory inspection/removal requirements.
5. Update `agent-cli`, `agent-sdk`, and `agent-runtime` SPEC files with ownership boundaries.
6. Add follow-up backlog links to process execution, background state, local memory, and repo
   context work.

## Acceptance Criteria

- [x] The contract defines action provenance, named states, memory inspection, and UI disclosure.
- [x] The contract separates CLI UI from SDK/runtime ownership.
- [x] The contract forbids hidden baseline automation and command inference.
- [x] The contract forbids remembered commands from becoming a baseline command source.
- [x] The contract requires user-impacting state and remembered values to be inspectable.
- [x] The contract does not require any repo-side Robota file or dependency.

## Test Plan

- Add type-level or unit tests for accepted action provenance values.
- Add state machine tests for allowed lifecycle transitions and invalid transition rejection.
- Add contract tests for memory projection fields: key, value summary, scope, source, storage
  location, last-used time, and deletion/disable capability.
- Add CLI rendering tests only after SDK/runtime contracts exist, verifying that provenance and
  state labels are visible without exposing private implementation details.

## Verification Plan

- `pnpm harness:scan`
- Document authority scan must pass when this backlog is later promoted.
- Implementation PRs must add contract tests before TUI screens.
- Tests must include repos without Robota files to prove the client remains repo-agnostic.

## Result

Completed by adding `.agents/specs/transparent-workflow.md` and linking package ownership from
`agent-runtime`, `agent-sdk`, and `agent-cli` SPEC files.

- The contract establishes action provenance, state vocabulary, memory inspection fields, UI
  disclosure, and repository independence rules.
- `agent-cli` remains a renderer of SDK/runtime projections.
- Runtime compatibility for current `waiting_permission` status is documented as a projection to
  user-facing `waiting-for-input`.
- Code-level provenance, state-machine, memory projection, and CLI rendering tests are deferred to
  the implementation backlogs that add those APIs.

# Transparent Process Execution for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - baseline local workflow capability for running user-supplied commands predictably.

## Request

Make `agent-cli` excellent at running commands the user chose or explicitly accepted, while keeping
the command's meaning owned by the user and repository.

The feature must answer:

> What exactly is running, where is it running, why was it selected, what can I do to it, and what
> happened when it finished?

## Non-Negotiable Product Principles

- **Command choice is user-directed.** `agent-cli` must not infer a repository harness contract,
  rank likely commands, or present a guessed command catalog as default behavior.
- **Commands are opaque capabilities.** `agent-cli` may run, display, and cancel user-directed
  commands, but it must not own their meaning or persist them as reusable preferences.
- **Process execution must be transparent.** The user must see origin, cwd, environment summary,
  status, output, cancellation policy, and terminal result.
- **Repo independence remains mandatory.** The runner must not require repo-side Robota adapters,
  manifests, scripts, hooks, or package dependencies.

## Execution Scope

Allowed baseline behavior:

- run user-entered commands;
- run commands explicitly accepted from assistant suggestions;
- stream output with pagination;
- support foreground and background process modes;
- support cancellation, timeout, exit code, duration, and retained output summary.

Restricted behavior:

- do not infer that a command is the canonical test/build/lint command;
- do not execute commands from remembered history, session recall, or user-local preference;
- do not score command readiness;
- do not judge command output as correctness evidence unless the user asks for advisory analysis;
- do not automatically start repair loops after failure.

## Expected Outcomes

- Users can tell exactly what command is running, why it was selected, where it is running, and how
  to stop it.
- Command execution becomes reliable enough for ordinary local work without requiring repo-specific
  Robota adapters.
- Commands run only from current user input or explicit acceptance, keeping command choice tied to
  present user intent.
- Failed commands are understandable as process results, not silently converted into diagnosis or
  repair workflows.
- Process state can be projected into the background work view without duplicating lifecycle logic
  inside `agent-cli`.

## Architecture Ownership Rule

`agent-cli` owns only process execution UI: prompt intake, run confirmation, output panes, keyboard
controls, and status rendering.

Lower owners must be established first:

- `agent-runtime`: process lifecycle, stdout/stderr streams, stdin policy, timeout, cancellation,
  exit status, duration, and retention limits.
- `agent-sdk`: stable process execution request/result APIs, command provenance, and projected
  process status.
- `agent-command-*`: user-visible run/status commands backed by SDK/runtime contracts.

Do not implement command semantics, output interpretation, retention policy, or process lifecycle
state inside `agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Define the process execution request contract: command, origin, cwd, env summary, stdin policy,
   timeout, foreground/background mode, and cancellation capability.
2. Define the process execution status contract: queued/running/waiting-for-input/completed/failed/
   cancelled/archived, latest output summary, exit code, duration, and retained transcript pointer.
3. Define output retention limits and truncation disclosure.
4. Update `agent-runtime`, `agent-sdk`, `agent-command-*`, and `agent-cli` SPEC files.
5. Add focused tests for command provenance, cancellation, terminal status, and output truncation.

## Acceptance Criteria

- [x] The process execution contract requires users to see what command is running, where it is
      running, and why it was selected.
- [x] The process execution contract requires commands to run only from current user input or
      explicit user acceptance.
- [x] The process execution contract covers foreground/background execution, cancellation, timeout, output paging,
      exit code, and duration.
- [x] The process execution contract states that command history or retained output does not become
      correctness evidence by default.
- [x] The process execution contract does not require repo-side Robota adapters or files.
- [x] The process execution contract requires CLI UI to depend on SDK/runtime contracts rather than
      owning process lifecycle state.

## Test Plan

- Add runtime tests for foreground and background process execution.
- Add runtime tests for cancellation, timeout, exit code, duration, and terminal status.
- Add output tests for stdout/stderr streaming, pagination, truncation, and truncation disclosure.
- Add SDK contract tests for command origin, cwd, environment summary, and process status
  projection.
- Add CLI tests that verify command origin, cwd, status, latest output, and terminal result are
  visible.
- Add negative tests proving remembered history, session recall, and user-local preferences cannot
  directly execute commands.
- Add negative tests proving command output is not classified as correctness evidence by default.

## User Test Scenarios

### Scenario: Review What A User-Directed Process Must Disclose

- Prerequisites: Open `.agents/specs/process-execution.md`.
- User actions: Read the request contract, status contract, output contract, command source rules,
  and ownership table.
- Expected visible result: The user can confirm that a future process UI must show command origin,
  cwd, environment summary, output, cancellation, timeout, exit result, and duration, while command
  meaning remains owned by the user/repository.
- Cleanup/reset: None.
- Agent verification: Static/manual review. Runtime process execution remains follow-up
  implementation work.

## Verification Plan

- `pnpm harness:scan`
- Add contract tests for process execution request/status models.
- Add runtime tests for cancellation, timeout, exit status, and output truncation.
- Add CLI tests only after SDK/runtime contracts exist.

## Result

Completed by adding `.agents/specs/process-execution.md` and linking package ownership from
`agent-runtime`, `agent-sdk`, `agent-cli`, and `agent-command-background` SPEC files.

- The contract defines process request, status, output, provenance, command-source, and ownership
  rules.
- Existing runtime/SDK/CLI process capabilities are audited separately from missing transparent
  process UI/API contracts.
- User-facing process-run commands, foreground process UI, SDK provenance types, and runtime/CLI
  tests remain follow-up implementation work.

---
name: state-machine-design
description: Designs finite state machines as pure, declarative transition tables with guards and actions. Use when modeling lifecycle states, status flows, or any system with discrete states and controlled transitions.
---

# State Machine Design Patterns

## Rule Anchor
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Execution Safety"

## Use This Skill When
- An entity has a lifecycle with discrete statuses (e.g., queued, running, success, failed).
- You need to prevent invalid state transitions at compile or runtime.
- Business logic depends on "current state + event → next state" decisions.
- You want transition logic to be testable as pure functions.

## Core Principles
1. **Declarative transition table**: all valid transitions are listed explicitly.
2. **Guard conditions**: boolean predicates that must be true for a transition to fire.
3. **Actions**: side-effect-free data transformations triggered on transition.
4. **Rejection by default**: any transition not in the table is an error.
5. **Purity**: the state machine itself has no I/O; callers perform side effects.

## Workflow
1. List all possible states as a union type or enum.
2. List all possible events (triggers).
3. Build a transition table: `(currentState, event) → nextState | error`.
4. Add guard conditions where transitions require extra checks.
5. Implement as a pure function: `transition(current, event, context?) → Result<nextState, TransitionError>`.
6. Callers invoke the function, then persist state and emit events.
7. Test exhaustively with table-driven test cases.

## Reference Skeleton
```ts
// 1. States and events as union types
type TTaskRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'upstream_failed' | 'skipped';
type TTaskRunEvent = 'DISPATCH' | 'LEASE_ACQUIRED' | 'COMPLETE' | 'FAIL' | 'SKIP' | 'UPSTREAM_FAIL';

// 2. Transition error
type TTransitionError = { from: TTaskRunStatus; event: TTaskRunEvent; reason: string };

// 3. Transition table (declarative)
const TASK_TRANSITIONS: Record<string, TTaskRunStatus | undefined> = {
  'queued:DISPATCH': 'running',
  'running:COMPLETE': 'success',
  'running:FAIL': 'failed',
  'queued:UPSTREAM_FAIL': 'upstream_failed',
  'queued:SKIP': 'skipped',
};

// 4. Pure transition function
function transitionTaskRun(
  current: TTaskRunStatus,
  event: TTaskRunEvent
): { ok: true; status: TTaskRunStatus } | { ok: false; error: TTransitionError } {
  const key = `${current}:${event}`;
  const next = TASK_TRANSITIONS[key];
  if (!next) return { ok: false, error: { from: current, event, reason: 'transition not allowed' } };
  return { ok: true, status: next };
}
```

If a reprocess path is required, model it behind an explicit policy gate in a separate layer instead of making `failed -> queued` part of the default machine.

## Checklist
- [ ] All states are listed as a finite union type.
- [ ] All events are listed as a finite union type.
- [ ] Transition table covers every valid (state, event) pair.
- [ ] Unlisted transitions return a typed error (no silent ignoring).
- [ ] Transition function is pure (no I/O, no logger, no storage).
- [ ] Guards are separate pure predicates when needed.
- [ ] Side effects (persist, emit event) happen in the caller, not the machine.
- [ ] Table-driven tests cover all valid transitions and at least one invalid per state.

## Anti-Patterns
- State machine that writes to DB or emits events internally.
- Using `if/else` chains instead of a declarative transition table.
- Silently ignoring invalid transitions instead of returning an error.
- States represented as magic strings instead of typed unions.
- Mixing transition logic with orchestration logic in the same function.

# CLI Premature Context Capacity Block

## Status

Completed.

## Priority

P1 - blocks normal CLI usage before the displayed context window is near the documented limit.

## Problem

The CLI can refuse to process a user prompt with:

```text
Context window is near capacity. Cannot process further in this round.
```

This was observed when the visible context state was around `80k/200k`, well below the displayed
200k context limit. After running compact, the visible state dropped to about `6.9k/200k`, but the
blocking behavior indicates that some internal capacity guard is using a stricter or inconsistent
state source than the status bar/context display.

Observed user flow:

```text
You:
  다른 cli들도 동일하게 받을텐데 왜 이것만 그러나요/

Robota:
  Context window is near capacity. Cannot process further in this round.

You:
  다른 cli들도 동일하게 받을텐데 왜 이것만 그러나?

Robota:
  Context window is near capacity. Cannot process further in this round.
```

## Scope

- `packages/agent-cli` context display and user-visible error rendering
- `packages/agent-sdk` interactive/session context state projection
- `packages/agent-sessions` context window tracking, compaction trigger, and per-round capacity guard
- Provider usage normalization if the guard depends on provider-reported token metadata

## Research Needed

- Identify the exact guard that emits `Context window is near capacity. Cannot process further in
  this round.`
- Compare all state sources used by:
  - status bar context display;
  - `/context` command output;
  - auto-compact threshold;
  - per-round "cannot process further" capacity guard;
  - post-compact context recalculation.
- Determine whether the guard includes a reserved output/tool-schema/system-prompt budget and, if
  so, whether that reserve is visible to users.
- Check whether context usage is stored as a fraction, percent, or token count and whether any
  threshold compares mixed units.
- Check whether compaction updates every cached context state used by CLI, SDK, and session layers.

## Constraints

- CLI/TUI must not own the capacity decision. It should render SDK/session state and structured
  diagnostics only.
- The blocking guard must be based on a single SDK/session-owned effective context state.
- If the guard reserves output tokens or tool/schema overhead, that reserve must be represented in
  the displayed diagnostics.
- Auto-compact should run before a hard block whenever compaction can create enough room.
- The fix must be provider-neutral and must not branch on concrete provider names.

## Recommended Direction

Introduce or clarify a single effective context budget model in the SDK/session layer:

- tracked used tokens;
- max context tokens;
- reserved output/tool/system overhead;
- hard-block threshold;
- auto-compact threshold;
- last compacted state;
- source of each value.

The CLI should display both raw usage and effective available budget when the session is close to a
guard. The hard-block error should include the values that caused the block, for example used tokens,
max tokens, reserved tokens, threshold, and whether compaction was attempted.

## Acceptance Criteria

- [x] A session at approximately `80k/200k` visible usage does not hard-block unless the effective
      budget calculation explains why it is unsafe.
- [x] The status bar, `/context`, auto-compact logic, and hard-block guard use the same effective
      context state or expose their differences explicitly.
- [x] If reserved output/tool/system overhead causes the block, the user-facing diagnostic includes
      that reserve.
- [x] Compaction updates every cached context state used by subsequent prompts.
- [x] Auto-compact is attempted before a hard block when enabled and applicable.
- [x] Regression tests cover a mid-window state such as `80k/200k` and prove a normal prompt is not
      rejected prematurely.
- [x] Regression tests cover a truly near-capacity state and prove the hard block or compaction path
      includes actionable diagnostics.

## Verification Plan

- Add unit tests for the effective context budget calculation in the owning session/SDK layer.
- Add regression tests for context state after manual compact.
- Add integration tests for `InteractiveSession.submit()` around mid-window and near-window states.
- Add CLI tests only for rendering the structured diagnostic if the user-facing output changes.
- Run `pnpm --filter @robota-sdk/agent-sessions test`,
  `pnpm --filter @robota-sdk/agent-sdk test`, and targeted CLI tests if touched.

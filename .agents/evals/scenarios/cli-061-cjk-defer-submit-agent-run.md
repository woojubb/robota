# CLI-061 — Korean-IME last-character drop fixed by defer-submit (agent-run)

**Spec:** CLI-061 (CJK-IME last-character drop on Enter). Proves the trailing IME syllable whose stdin event
arrives just after Enter is included in the submitted value.
**Type:** agent-executable (the agent renders the real `InputArea`/`CjkTextInput` headlessly and drives the
byte-ordering race; no owner terminal smoke — per the agent-run capability rule).

## Scenario

```bash
pnpm --filter @robota-sdk/agent-transport-tui build

# Integration (red-before-green): render the REAL CjkTextInput, write the composed text, write '\r', then write
# the trailing syllable AFTER Enter, wait past the defer window, and assert the FULL value was submitted.
npx vitest run packages/agent-transport-tui/src/__tests__/cjk-defer-submit.test.tsx
# Unit: the deferred-submit orchestration reads the LATEST value at fire time, guards double-submit, cancels.
npx vitest run packages/agent-transport-tui/src/flows/__tests__/defer-submit.test.ts
```

**Expected:** the submitted value is the full `안녕하세요` (not `안녕하세`); no double-submit on a second Enter;
build green.

## Observed (2026-07-23)

```
✓ CLI-061 — CjkTextInput defer-submit (integration)
    ✓ includes a trailing syllable that arrives after Enter (안녕하세 + Enter + 요 → 안녕하세요)
    ✓ a second Enter within the window does not double-submit
Tests  2 passed

✓ scheduleDeferredSubmit (CLI-061)
    ✓ submits the LATEST value at fire time, not the value at schedule time (the trailing char)
    ✓ ignores a second submit while one is in flight (no double-submit), but does not touch input
    ✓ a fresh submit is allowed after the previous one fires
    ✓ cancel clears a pending timer and releases the guard (no submit after unmount)
Tests  4 passed

Full agent-transport-tui suite: 426 passed (59 files), no regression.
```

**Red-before-green proof (anti-accidental-green):** temporarily reverting the fix (submit synchronously with
the Enter-captured `effect.value`) makes the integration test FAIL exactly as the bug does —
`onSubmit` fires immediately with `안녕하세` (missing `요`) and a second Enter double-submits. Restoring the
fix turns it green. So the test genuinely fails on the pre-fix code.

✅ PASS — the fix defers the submit `IME_SUBMIT_DEFER_MS (50ms)` and re-reads the LIVE `stateRef.current.value`
at fire time, so a trailing IME character applied after Enter is included. The input pipeline stays live during
the window (the guard blocks only a second submit); the timer is cancelled on unmount. Migration off Ink was
rejected — the drop is a terminal raw-mode timing race shared by all Node TUIs (Gemini CLI fixed the identical
bug the same way on the same Ink). Out of scope: the cursor-positioning SIGSEGV (CLI-062) and in-line pre-edit
display.

**Note (deeper form):** a `spawnPtyFixture` real-pty replay (write `\r` then delayed trailing UTF-8 bytes) would
additionally exercise real-terminal byte delivery; the in-process `ink-testing-library` render above already
drives the real component + handler + defer through Ink's `useInput`, and proves the fix red-before-green.

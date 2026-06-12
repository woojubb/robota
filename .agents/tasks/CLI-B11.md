# Tasks — CLI-B11: Session-switch context restoration regression tests

Spec: `.agents/spec-docs/active/CLI-B11-session-switch-regression-tests.md`
Test Plan SSOT: the spec's TC table. One task per TC-N plus wrap-up.

- [x] T1 (TC-01): `session-switch-channel.test.tsx` — render real `App` (ink-testing-library)
      with mock `createChannel` + fake channel object satisfying `useTuiChannel`/`AppInner`
      surface; trigger a session switch through the real `SessionPicker`
      (`showSessionPickerOnStart` + stdin select) → `createChannel` called exactly once with
      the selected sessionId.
- [x] T2 (TC-02): `channel-factory-integration.test.ts` — real `FileSessionStore` in temp
      dir with a persisted session containing messages; build the channel via the real
      `toChannelOptions`/`TuiInteractionChannel` path with `resumeSessionId` and the
      scripted provider (src/testing); after `start()`, restored context
      `usedTokens > 0`. No mocks of store/session.
- [x] T3 (TC-03): on switch, previous channel `stop()` invoked (idempotent — switch
      handler + AppInner cleanup both stop it, per the spec's documented TC-03 correction);
      new channel started; active channel never stopped.
- [x] T4 (TC-04): rendering `App` without a `createChannel` prop falls back to
      `props.channel` on switch and does not crash (pins current fallback until CLI-B12).
- [x] T5 (TC-05): consecutive switches A→B→C — drive picker reopen via
      `session-picker-requested` command effect queued on the active mock channel +
      `handleSubmit` drain; each switch creates one new channel via the factory with the
      right id, stops the prior channel, latest channel is the one rendered.
- [x] T6 (TC-06): full `pnpm --filter @robota-sdk/agent-transport test` green including the
      two new suites; `docs/SPEC.md` Test Strategy lists both files.
- [ ] T7: wrap-up — typecheck/lint/build green; PR to develop (squash); backlog
      `.agents/backlog/CLI-B11-*.md` User Execution Test Scenario evidence recorded and file
      moved to completed/.

## Test Plan

Authoritative TC table: `.agents/spec-docs/active/CLI-B11-session-switch-regression-tests.md`
(## Test Plan). Summary: TC-01/03/04/05 via `session-switch-channel.test.tsx`
(ink-testing-library, mock createChannel); TC-02 via `channel-factory-integration.test.ts`
(real project session store + real TuiInteractionChannel, restored usedTokens > 0);
TC-06 = full `pnpm --filter @robota-sdk/agent-transport test` + SPEC.md Test Strategy rows.
User-execution evidence: real-binary PTY /resume scenarios recorded in
`.agents/backlog/completed/CLI-B11-session-switch-context-restoration-tests.md`.

# SCREEN-010 Tasks — Chat-window layout via Ink `<Static>`

Spec: `.agents/spec-docs/active/SCREEN-010-tui-static-scrollback-chat-layout.md`

## Tasks (TDD: write/extend the failing test first, then implement)

- [ ] T1 (TC-01): Export `EntryItem` from `MessageList.tsx`; render committed history via
      `<Static items={committedHistory}>` in `App.tsx`. Add ink-testing-library test asserting
      finalized entries appear in the static frame and are not re-rendered.
- [ ] T2 (TC-02): Keep `InputArea` + `SessionStatusBar` + in-flight indicators as the dynamic live
      region below `<Static>`. Test: a re-render with new streaming text changes only the live region.
- [ ] T3 (TC-03): Split committed vs. in-flight: the streaming assistant message renders dynamically
      and is excluded from `committedHistory` until finalized; once final it appears exactly once in
      Static. Test the streaming→commit transition (no duplicate, no missing entry).
- [ ] T4 (TC-04): Ensure terminal-handoff suspend/resume does not re-emit the whole committed
      history. Coordinate with `terminal-handoff-controller.ts` / `useTerminalHandoffSuspension.ts`.
      Add a PTY E2E (TEST-007 `spawn-pty` / ptytest) asserting no full re-print after `/shell`.
- [ ] T5 (TC-05): Manual smoke on a real terminal: native scrollback reachable, input pinned during
      normal use. Record evidence.
- [ ] T6 (TC-06/07/08): `pnpm --filter @robota-sdk/agent-transport-tui typecheck` + `test` + `build`
      and `pnpm harness:scan` all green.

## Test Plan

Mirror the spec's Test Plan: ink-testing-library frame/diff assertions for the committed-vs-live split
and the streaming→commit transition (TC-01–TC-03); a PTY E2E via the TEST-007 `spawn-pty` harness for
the handoff no-re-print regression (TC-04); a manual real-terminal scrollback smoke (TC-05); and the
standard typecheck/test/build/harness:scan gates (TC-06–TC-08). Each TC must show evidence in the
spec's Evidence Log before GATE-VERIFY.

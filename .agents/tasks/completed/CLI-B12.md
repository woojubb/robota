# Tasks — CLI-B12: TuiInteractionChannel lifecycle — single React owner (Option A)

Spec: `.agents/spec-docs/active/CLI-B12-channel-lifecycle-react-ownership.md`
Test Plan SSOT: the spec's TC table.

- [x] T1 (TC-01): `App.tsx` — channel created in the `useState` lazy initializer via the
      required `createChannel` prop; `render.tsx` no longer constructs a channel (grep +
      mock-factory initial-render test: factory called exactly once per mount).
- [x] T2 (TC-02): `onSessionSwitch` stops the old channel before the new channel becomes
      active (spied `stop()` vs factory invocation order assertion).
- [x] T3 (TC-03): CLI-B11 suite TC-A/B/C/E assertions pass unchanged on the new structure
      (TC-D replaced per spec — factory now mandatory).
- [x] T4 (TC-04): `IAppProps` drops `channel` and requires `createChannel`;
      `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0; build green.
- [x] T5 (TC-05): end-to-end restored context — real-store integration suite green
      (channel-factory-integration.test.ts) and/or PTY /resume scenario shows Context > 0%.
- [x] T6 (TC-06): `docs/SPEC.md` documents single-owner channel lifecycle
      (created/replaced/stopped only via App state; render.tsx supplies only the factory).
- [x] T7: wrap-up — full package test/typecheck/lint/build green; PR to develop (squash);
      backlog `.agents/backlog/CLI-B12-*.md` completion criteria checked + moved to
      completed/ with evidence.

## Test Plan

Authoritative TC table: `.agents/spec-docs/active/CLI-B12-channel-lifecycle-react-ownership.md`
(## Test Plan). Summary: TC-01/02/03 via the updated
`session-switch-channel.test.tsx` (mock factory, initial render + switch ordering);
TC-04 via typecheck/build; TC-05 via `channel-factory-integration.test.ts` + PTY
/resume scenario; TC-06 via SPEC.md diff review at GATE-COMPLETE.

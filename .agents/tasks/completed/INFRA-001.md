# INFRA-001 Tasks

Spec: `.agents/spec-docs/active/INFRA-001-tui-channel-lifecycle-fix-and-tests.md`

## Tasks

- [x] TC-01/TC-02: Add `useEffect` with `channel.start()` / `channel.stop()` to `App.tsx`
- [x] TC-03: Document `write()` as intentionally unused in `TuiInteractionChannel.ts`
- [x] TC-04–TC-09: Write Group A tests (lifecycle) in `TuiInteractionChannel.lifecycle.test.ts`
- [x] TC-10–TC-13: Write Group B tests (handleInput roundtrip)
- [x] TC-14–TC-16: Write Group C tests (onChange propagation)
- [x] TC-17: `pnpm --filter @robota-sdk/agent-transport test` exits 0
- [x] TC-18: `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0

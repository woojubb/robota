# INFRA-018 Tasks — CLI `--session-log` replay flag + conversation E2E

Spec: `.agents/spec-docs/active/INFRA-018-cli-replay-provider-flag.md`

## Tasks

- [ ] T1 (TC-01): parse `--session-log <path>` into `IParsedCliArgs.sessionLog`; in `cli.ts`, when
      `provider === 'replay'` + `sessionLog` set, build the provider via
      `createReplayProviderFromLogFile(path)` and stub the settings-derived values (modelId,
      providerSettings) so the network-provider config path is bypassed. Add the
      `@robota-sdk/agent-provider-replay` dependency to agent-cli.
- [ ] T2 (TC-02/03): `replay-conversation.ptytest.ts` — boot the built CLI with
      `--provider replay --session-log <fixture>`, send a message, assert the recorded response
      renders then commits once to `<Static>` scrollback and the input stays pinned. Commit a small
      recorded session-log fixture.
- [ ] T3 (TC-04/05): existing `tui-pty` suite stays green (non-replay unaffected); agent-cli
      typecheck + build + `pnpm harness:scan` green.

## Test Plan

Real-binary PTY E2E (`replay-conversation.ptytest.ts`) driving a recorded session log through the
built CLI + the existing `spawnTui` harness, asserting streaming→commit + pinned input; existing
`tui-pty` non-replay suite as the no-regression guard; typecheck/build/harness:scan. Each TC shows
evidence in the spec Evidence Log before GATE-VERIFY.

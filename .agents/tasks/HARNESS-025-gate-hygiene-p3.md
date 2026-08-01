---
title: 'HARNESS-025: 게이트 위생 잔여: MOCK allowlist 번다운·실 sleep·env 변이·PTY HOME 격리'
status: in-progress
created: 2026-07-04
priority: low
urgency: later
area: scripts/harness, packages
depends_on: ['HARNESS-023']
---

# 게이트 위생 잔여: MOCK allowlist 번다운·실 sleep·env 변이·PTY HOME 격리

Re-audit P3 (GATE-004/007/008/009). MOCK-001 allowlist 잔존, 실 벽시계 sleep 의존(cache
TTL 100ms, PTY 300ms), vi.stubEnv 없는 env 변이, PTY e2e 실HOME 전달(조건부 플레이크).

## What

1. PTY e2e temp HOME 주입; cache TTL fake timers; env 변이 → vi.stubEnv 전환.
2. MOCK-001 번다운 진행률 점검 + 감축 목표 기록.

## Progress (2026-07-25)

### 1a. PTY e2e temp HOME — DONE

`@robota-sdk/agent-testing` gained `createPtyEnv` / `createIsolatedHome` / `disposeIsolatedHomes`
(`src/pty/isolated-home.ts`). Every PTY child now gets an empty throwaway HOME, including
`spawnPty`'s **default** env — so the leak cannot be reintroduced by a caller who simply omits `env`.
`agent-transport-tui`'s two PTY e2e suites use it; `pty/pty-driver.ts` already took an explicit
`homeDir` and was the model.

Four self-tests pin the contract, one of which asks the child to report the `HOME` it actually sees.
Red-first proof — restoring the old `HOME: process.env['HOME']` default fails it:

```
× PTY HOME isolation > does not hand the real HOME to a child when no env is supplied
  → expected '/home/ubuntu' not to be '/home/ubuntu'
```

### 1b. cache TTL fake timers — DONE

`apps/agent-web/src/lib/cache.test.ts` (Jest, not vitest — so `jest.useFakeTimers()`) no longer
sleeps on the wall clock. Both TTL cases also gained a _before-expiry_ assertion, so they now pin the
TTL boundary rather than only its far side. Red-first proof, two independent mutations of
`SimpleCache`:

```
# get() expiry disabled
● SimpleCache › expires values after TTL — expect(received).toBeNull() / Received: "value1"
# cleanup() over-evicts (ttl compare → >= 0)
● SimpleCache › cleans up expired entries — Expected: 2 / Received: 0
```

The remaining 300ms PTY sleeps are **deliberate and load-bearing**: they pace a real child process
through a real pseudo-terminal (waiting for the child to reach its `read()`). Fake timers cannot
advance another process's clock, so converting them would break the test, not harden it.

### 1c. env 변이 → vi.stubEnv — DONE for every owned package

19 test files / ~110 mutation sites converted across `dag-cli`, `dag-nodes`, `dag-framework`,
`agent-core`, `agent-tools`, `agent-command`, `agent-transport-tui`. Manual save/restore bookkeeping
was deleted in favour of `vi.unstubAllEnvs()`. Four latent leaks were fixed as a side effect:

- `dag-cli/init-command` restored `CI` from a possibly-`undefined` value, which Node coerces to the
  string `"undefined"` — a truthy `CI` leaking into every later test.
- `dag-cli/runner-cli` deleted `CI` and never restored it.
- `dag-cli/describe-command` set `ANTHROPIC_API_KEY` with no `afterEach` at all.
- `agent-tools/web-search-{tool,provider}` used `stubEnv` but never unstubbed, leaking
  `BRAVE_API_KEY` out of the suite.

### 2. MOCK-001 번다운 점검 — DONE

Checked and acted on, not merely recorded: the allowlist went **32 → 3**. Full analysis and the
before/after table live in `MOCK-001-hardcoded-workspace-mock-burndown.md` (the SSOT for that count).
Headline: two thirds of the list were never hardcoded — the detector could not see the
`vi.importActual` spread form and truncated long factories at 600 characters. The scan now extracts
the factory by balanced parens, accepts both original-import spellings, requires the original to be
**spread** rather than merely loaded, and fails on stale allowlist entries so the list can only shrink.

## Remaining

Only `1c` has a remainder, and it is purely an ownership deferral — 19 test files in packages a
concurrent work-stream (ARCH-005 S2) owns, so they were not touched.

**Re-verified 2026-07-26 against `origin/develop`: all 19 are still unconverted — none was picked up
by another stream.** The exact set, reproduced by
`rg -l "delete process.env|process\.env\.[A-Z_]* *=|process\.env\[[^]]*\] *=" packages/agent-cli/src
packages/agent-framework/src packages/agent-executor/src` (which returns these 19 test files plus the
one non-test file `packages/agent-cli/src/init/init-command.ts`, out of scope):

- `packages/agent-cli/` — 8 files: `startup/__tests__/provider-startup.test.ts`,
  `__tests__/provider-factory-integration.test.ts`, `__tests__/cli-exit-codes.test.ts`,
  `__tests__/cli-command-composition.test.ts`, `__tests__/cli-update-check.test.ts`,
  `subagents/__tests__/git-worktree-isolation-adapter.test.ts`, `__tests__/e2e/slash-smoke.test.ts`,
  `__tests__/e2e/scripted-e2e.test.ts`
- `packages/agent-framework/` — 10 files: `__tests__/config-loader.test.ts`,
  `__tests__/settings-check.test.ts`, `__tests__/e2e-scenarios.test.ts`,
  `__tests__/filesystem-smoke.test.ts`, `__tests__/provider-configuration.test.ts`,
  `__tests__/provider-settings.test.ts`, and `interactive/__tests__/interactive-session-{auto-capture,
checkpoints,memory,recall}.test.ts`
- `packages/agent-executor/` — 1 file: `providers/provider-factory.test.ts`

Spot-checked shape, so the next agent knows what a conversion looks like here:
`packages/agent-cli/src/startup/__tests__/provider-startup.test.ts` contains **zero** `vi.stubEnv`
calls and mutates directly at `:192-194` (`delete process.env.OPENAI_API_KEY` /
`DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY`). The conversion is the same one `1c` already applied to 19
files across seven other packages: replace hand-rolled save/restore with `vi.stubEnv` +
`vi.unstubAllEnvs()` in `afterEach`.

Several of these swap `process.env.HOME` by hand, which is the same conditional-flake class as `1a`.

**Closing condition:** all 19 converted and each package's suite green at its recorded baseline count.
Nothing else in this item is outstanding — `1a`, `1b` and `2` are done and evidenced above.

## Test Plan

- 격리 HOME 전체 스위트 green; 하네스 스위트 green.

## User Execution Test Scenarios

Not applicable — test-hygiene only. Engineering evidence: isolated-env suite runs.

Evidence (2026-07-25):

- `agent-testing` 6/6 (4 new HOME-isolation tests), `agent-transport-tui` 69 files / 526 tests
  including all 3 PTY e2e suites, `agent-core` 904, `agent-command` 244, `agent-tools` 202,
  `dag-framework` 107, `dag-cli` 63 files / 1007 tests, `dag-nodes` 351 across 20 packages,
  `agent-web` cache 8/8. Every count matches the pre-change baseline — no test dropped or skipped.
- `node scripts/harness/check-test-module-mocks.mjs` → `test-module-mocks scan passed (3 legacy
allowlisted).` Scan unit tests 18/18.

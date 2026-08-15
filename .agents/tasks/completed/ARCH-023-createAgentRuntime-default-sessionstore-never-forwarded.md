---
title: 'ARCH-023: createAgentRuntime computes a default sessionStore it never forwards to createSession — the runtime store is dead, stateless and default runtimes persist identically, and resume via the runtime default silently cannot restore'
status: done
completed: 2026-08-15
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-015]
---

# ARCH-023: the runtime-level sessionStore is never inherited

## Problem

`createAgentRuntime` eagerly defaults a `sessionStore` and documents runtime fields as auto-inherited,
but `createSession()` forwards only the per-call `opts.sessionStore` — never the runtime-level store.
So the runtime default (and a runtime-configured store) is dead, `createStatelessRuntime`'s
`sessionStore: undefined` is behaviorally identical to the default runtime, and `resumeSessionId`
through the runtime default silently no-ops. This violates the factory context auto-forwarding rule
(`project-structure.md:123`).

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-framework/src/runtime/agent-runtime.ts:85-86` — defaults
  `sessionStore = createProjectSessionStore(config.cwd)`; `:34` JSDoc "Runtime fields (cwd, provider,
  etc.) are inherited automatically."
- `agent-runtime.ts:98-123` — `createSession()` passes `sessionStore: opts.sessionStore` only; the
  runtime-level store appears solely as the exposed `runtime.sessionStore` property (`:95`), which no
  code in the repo reads back.
- No rescue path: `createAgentRuntime` callers (starter-nextjs route, `eval-command` via
  `createSessionRunFn`) never pass `opts.sessionStore`; the CLI's persistent flows bypass
  `createAgentRuntime` via `cli.ts:335` + `buildRuntimeSession`. `resumeSessionId` restore is gated on
  `options.sessionStore` (`interactive-session.ts:156,312`), so resume via the runtime default no-ops.
  `SessionStore` construction is lazy/side-effect-free, so stateless and default runtimes are
  indistinguishable for persistence.

## Direction

Forward the runtime-level store in `createSession`:
`sessionStore: 'sessionStore' in opts ? opts.sessionStore : sessionStore` (explicit override wins,
factory auto-forwarding rule) — OR stop computing/exposing the runtime default and document that
headless runtime sessions are unpersisted unless a store is passed per call. Pick one; today the field
is a promise the code does not keep.

## Endorsed Recommendation

Keep the runtime-owned default project store and make `createSession()` resolve one effective store by
property presence: omission inherits the runtime store, an explicit store overrides it, and explicit
`undefined` disables persistence. Encode that tri-state public contract in both
`IAgentRuntimeConfig.sessionStore` and `IHeadlessSessionOptions.sessionStore` as optional properties whose
value type also includes `undefined`, so consumers using `exactOptionalPropertyTypes` can express the
disable case. Pass only the resolved store into `InteractiveSession`.

Preserve `createStatelessRuntime` semantics: an omitted per-session store inherits the runtime's explicit
`undefined`, while a caller-supplied per-session store can deliberately re-enable persistence. Update the
framework SPEC and JSDoc with this precedence. Prove RED first, then cover default inheritance, custom
override, explicit disablement, stateless default disablement, stateless per-session re-enablement, and a
real public `createAgentRuntime` persist→resume round trip. The public scenario is deterministic,
provider-key-free, isolated under a temporary cwd, and cleans up. Add the framework behavior changeset.

Depth review on 2026-08-15 classified the defect `LOCAL` (0 foundational): the factory already owns the
canonical store and drops only that context field. Independent proposal review first returned `REVISE`
because the public option types did not express explicit `undefined` under `exactOptionalPropertyTypes`;
after the tri-state types and complete stateless matrix were added, it returned
`REVIEW VERDICT: ENDORSE` on 2026-08-15.

## Test Plan

- Red-first: prove that `createAgentRuntime({ cwd }).createSession({})` receives no effective store and
  cannot persist/resume before the fix.
- Cover the complete precedence matrix: omitted inherits runtime default, explicit custom store wins,
  explicit `undefined` disables, stateless omission stays disabled, and a stateless per-session store
  re-enables persistence.
- Run the maintained public SDK persist→resume scenario and record its deterministic output.
- Pass package test/build/typecheck/lint, SPEC conformance, functional-coverage where applicable, and
  `pnpm harness:verify -- --scope packages/agent-framework --include-scenarios --base-ref origin/develop`.

RED proof (2026-08-15):
`volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-framework exec vitest run src/runtime/__tests__/agent-runtime-session-store.test.ts`
failed 1/5 with exit code 1 on the pre-fix factory because the default-runtime session file did not
exist after shutdown; the other four matrix cases passed.

## Implementation Tasks

- [x] Update the public tri-state option contracts, runtime inheritance logic, JSDoc, and framework SPEC.
- [x] Add the complete RED-first runtime/store precedence and resume regression matrix.
- [x] Add the maintained public-SDK example, package scenario commands, and scenario record.
- [x] Add the framework behavior changeset and any required durable functional-coverage registration.
- [x] Run focused, scoped, SPEC, scenario, and done-gate verification with exact evidence.

## Verification Evidence

- Focused GREEN: the runtime/store regression matrix passed 5/5. The full `agent-framework` package
  suite passed 163/163 files and 1,340/1,340 tests.
- Static/build gates: package build and typecheck passed. Lint completed with zero errors and 153
  existing warnings. Prettier and `git diff --check` passed.
- SPEC conformance: the public-surface and package-SPEC scans passed; package-SPEC coverage remained
  86/86. The changed runtime factory options, tri-state precedence, stateless behavior, and resume
  path are documented in the framework SPEC and match the implementation and executable matrix.
- Functional coverage: the registry scan passed with all 12 declared capabilities covered. No new
  CLI manifest row was added because this change is a public SDK runtime-factory behavior; the
  maintained public-SDK scenario directly exercises it, while the existing multi-session capability
  continues to own the underlying resume behavior.
- Scoped harness evidence is composite and change-complete. The full command reached the repository
  harness tier and passed 3,362/3,364 tests; two unrelated process-heavy harness cases exceeded the
  shared 30-second timeout. Immediate isolation of both files passed 59/59 in 22.65 seconds, including
  the formerly timed-out cases in 859 ms and 2 ms. All ARCH-023 focused, package, build, typecheck,
  lint, SPEC, functional-coverage, and recorded-scenario checks passed independently.

## User Execution Test Scenarios

**Applies — this changes persistence and resume behavior reachable through the public
`@robota-sdk/agent-framework` SDK surface.**

### Scenario ARCH-023-S1 — the runtime default store persists and resumes across runtime instances

- **Agent executability:** `agent-executable`. The scenario is a non-interactive public-SDK example
  driven by the deterministic scripted provider. It needs no TTY, network, external service, provider
  key, or seeded user data.
- **Surface choice:** preference level 1, a self-contained product observable. The maintained example
  imports `createAgentRuntime` from the package's public barrel and `createScriptedProvider` from the
  public `@robota-sdk/agent-core/testing` subpath, drives two real `InteractiveSession` instances, and
  prints deterministic JSON to stdout. The second provider's captured public request is the direct
  observable that the earlier user/assistant context reached the resumed model call. Every mismatch
  throws, so the process exits non-zero instead of printing a false success. No lower-preference
  fixture server or credential-backed run is warranted.
- **Executability probe (2026-08-15):** the package-local source runner and both public imports were
  probed with
  `volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-framework exec tsx --conditions=source -e "..."`.
  It returned exit code `0` and printed
  `{"createAgentRuntime":"function","providerName":"scripted-test-provider","requestsArray":true}`.
  The exact planned command below was also attempted; package selection resolved, but pnpm reported
  `None of the selected packages has a "scenario:verify" script`. Therefore the runner/import surface
  exists while the maintained example and package scripts do not yet exist. They are explicitly part
  of this backlog's implementation scope; the absent-script probe is not user-execution evidence.
- **Prerequisites:** Node 22.14.0 through Volta and installed workspace dependencies. The implementation
  adds the maintained standalone example
  `packages/agent-framework/examples/verify-agent-runtime-session-store.ts`
  <!-- allow-missing-artifact: ARCH-023 implementation scope creates this planned scenario artifact -->
  and a package-owned `scenario:verify` script that runs it with
  `pnpm exec tsx --conditions=source`. It also adds the matching `scenario:record` command and
  `packages/agent-framework/examples/scenarios/agent-runtime-session-store.record.json`
  <!-- allow-missing-artifact: ARCH-023 implementation scope creates this planned scenario record -->
  so scoped scenario verification can compare the maintained observable. The example itself creates
  all runtime state in a unique operating-system temporary directory.
- **Fixture/setup and ordered behavior performed by the example:**

  1. Create one isolated temporary `cwd` and a first scripted provider whose sole reply is
     `ARCH-023 stored runtime-default-store`.
  2. Construct the first public runtime with only `{ cwd, provider }`, call its public
     `createSession({})`, submit `ARCH-023 remember runtime-default-store`, await that real turn's
     `completed` promise, capture the session id, and await `shutdown()` so the production persistence
     path flushes the record. Do not pass a session store to the session call.
  3. Construct a second public runtime over the same `cwd` with a fresh scripted provider whose sole
     reply is `ARCH-023 restored runtime-default-store`. Create its session with exactly
     `{ resumeSessionId }` — specifically no per-call `sessionStore` — submit
     `ARCH-023 recall runtime-default-store`, and await the turn's `completed` promise.
  4. Assert the resumed session id equals the first id; the second provider received both the prior
     user prompt and prior assistant reply before the current prompt; the resumed public message
     history contains the two prior and two current messages in `user, assistant, user, assistant`
     order; and both scripted responses match their sentinels.
  5. Await the second session's shutdown, remove only the exact temporary directory created by this
     process, assert that it no longer exists, and then print the success JSON. A `finally` path repeats
     bounded shutdown/removal for failures without touching any pre-existing path.

- **Exact command:**

  ```bash
  volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-framework scenario:verify
  ```

- **Expected observable:** exit code `0`, with the example printing this JSON document after the package
  script header (object whitespace is not contractual):

  ```json
  {
    "scenario": "ARCH-023",
    "firstResponse": "ARCH-023 stored runtime-default-store",
    "resumedResponse": "ARCH-023 restored runtime-default-store",
    "sameSessionId": true,
    "resumedProviderRequest": {
      "priorUserPromptPresent": true,
      "priorAssistantReplyPresent": true,
      "currentPromptPresent": true
    },
    "resumedHistory": {
      "messageCount": 4,
      "roles": ["user", "assistant", "user", "assistant"]
    },
    "cleanupRemoved": true
  }
  ```

  Before the fix, the first session receives no effective store, so no record is available to the
  second runtime and at least the prior-context assertions fail with a non-zero exit. After the fix,
  this output proves the runtime-created default store was used by both sessions and the second
  session restored context using `resumeSessionId` alone.

- **Cleanup/reset:** cleanup is owned by the example. Both sessions are shut down if constructed;
  recursive deletion is restricted to the one `mkdtemp` result; the success output is emitted only
  after `existsSync(cwd) === false`. No user config, repository file, or shared session directory is
  changed.
- **Evidence (2026-08-15):** the exact command exited `0` and printed the expected ARCH-023 JSON:
  both response sentinels matched, `sameSessionId` and all three resumed-provider-request flags were
  `true`, the resumed history contained four messages in `user, assistant, user, assistant` order,
  and `cleanupRemoved` was `true`. A second captured execution compared against
  `packages/agent-framework/examples/scenarios/agent-runtime-session-store.record.json`: stdout
  SHA-256 `cfea513dc6152d1d9e0416115a9181f0ff4670916efa1f870923e01100f6be20`, empty-stderr SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, differences `[]`. Durable
  execution lives in `packages/agent-framework/examples/verify-agent-runtime-session-store.ts`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — `DONE-GATE-STAGE-1` is an entry gate with no predecessor. The current factory still
  forwards `sessionStore: opts.sessionStore`, while the maintained example, package scripts, and scenario
  record are absent, so the ARCH-023 implementation has not preceded this written-scenario gate.
- Scenario `ARCH-023-S1`: PASS — it records the explicit `agent-executable` decision, Node/workspace
  prerequisites, ordered fixture behavior, the exact Bash command, exit-code and JSON observables,
  bounded cleanup, and a separate pending evidence field for the post-implementation run.
- Public reachability: PASS — the scenario drives `createAgentRuntime` from the public
  `@robota-sdk/agent-framework` barrel and `createScriptedProvider` from the public
  `@robota-sdk/agent-core/testing` subpath through two real `InteractiveSession` turns. It observes the
  resumed provider request and public message history rather than substituting build, typecheck, lint,
  tests, harness/CI output, or repository-text inspection for the SDK behavior.
- Invocation and fixture readiness: PASS — an independent source-runner probe on 2026-08-15 exited `0`
  with `{"createAgentRuntime":"function","providerName":"scripted-test-provider","requestsArray":true}`.
  The exact planned command currently reports that `scenario:verify` is absent; the plan explicitly folds
  that package script, the maintained example, `scenario:record`, and the scenario-record artifact into
  ARCH-023 implementation scope with `allow-missing-artifact` markers.
- Expected observable: PASS — the plan requires exit `0` and deterministic JSON naming both scripted
  responses, equal session identity, all three resumed-request sentinels, four messages in
  `user, assistant, user, assistant` order, and `cleanupRemoved: true`. Every mismatch is specified to
  throw before success output, so a missing restore cannot produce a false pass.
- Credentials, external services, and cleanup: PASS — the scenario explicitly requires no TTY, network,
  external service, provider credential, environment variable, or seeded user data. It creates a unique
  OS-temporary directory, shuts down both sessions, removes only that exact directory on success and
  failure paths, proves its absence, and does not mutate user config or repository state.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario written → scenario executed and verified

- Ordering: PASS — `DONE-GATE-STAGE-1` has a recorded PASS above, the Task remains `in-progress`, and
  its implementation tasks and engineering evidence record the completed implementation before this
  independent execution gate.
- Direct execution: PASS — the guardian ran Scenario `ARCH-023-S1` twice with the exact public-SDK
  command `volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-framework scenario:verify`; both
  executions exited `0` against the current implementation.
- Expected observable: PASS — each run emitted the two expected response sentinels,
  `sameSessionId: true`, all three resumed-provider-request flags as `true`, four public-history
  messages in `user, assistant, user, assistant` order, and `cleanupRemoved: true`.
- Concrete recorded evidence: PASS — the scenario evidence field above records the command result and
  names the durable executable artifact
  `packages/agent-framework/examples/verify-agent-runtime-session-store.ts` and canonical record
  `packages/agent-framework/examples/scenarios/agent-runtime-session-store.record.json`. Independent
  record validation returned `[]`; comparison returned differences `[]`, stdout SHA-256
  `cfea513dc6152d1d9e0416115a9181f0ff4670916efa1f870923e01100f6be20`, and empty-stderr SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Evidence quality and cleanup: PASS — the verdict relies on the public SDK scenario output, not
  build/test/lint/harness/CI results. A post-run probe found no remaining `arch-023-example-*`
  directory under the operating-system temporary root, consistent with the emitted cleanup proof;
  the scenario introduced no additional repository change.

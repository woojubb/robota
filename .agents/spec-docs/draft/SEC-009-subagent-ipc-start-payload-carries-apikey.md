---
status: draft
type: SECURITY
tags: [cli, typescript, auth]
---

# SEC-009: the subagent IPC start payload carries the credential value instead of a reference

## Problem

`createProviderProfile` (`packages/agent-subagent-runner/src/child-process-subagent-runner.ts:211-228`)
builds the `ISerializableProviderProfile` that crosses the child-process boundary, and copies the
credential through verbatim:

```ts
apiKey: provider.apiKey,
```

That value is whatever the resolved provider config holds. The repository permits it to be a
plaintext secret: `isApiKeyPlaintext` exists precisely because a profile may hold one, and the policy
that forbids it — `IOrgPolicy.requireApiKeyFromEnv` — is **opt-in** and is enforced at exactly one
site, profile editing (`packages/agent-command/src/provider/provider-command-profile-operations.ts:123`).
No policy is consulted on the spawn path.

So on a default installation whose profile holds a literal key, `spawn(…, { stdio: [..., 'ipc'] })`
followed by the start message places that plaintext secret into a structured-clone IPC payload — a
second copy of the credential, in a second process, reachable by anything that observes the channel
(IPC instrumentation, `NODE_DEBUG`, a core dump, or any future logging of the start payload, none of
which the credential's owner opted into).

Reproduction condition: any `/agent run` that selects the child-process subagent runner while the
active provider profile stores a literal `apiKey` rather than a `$ENV:` reference. This is the
default-permitted configuration, not a misconfiguration.

**The mechanism to avoid it is already present on both sides and unused on this path:**

- `ISerializableProviderProfile` already declares `apiKeyEnv?: string`
  (`packages/agent-interface-transport/src/background-task-contracts.ts:65`).
- `resolveProfileApiKey` already resolves both forms — `resolveEnvReference(profile.apiKey)` for a
  `$ENV:` reference and `process.env[profile.apiKeyEnv]` for the indirection field
  (`packages/agent-executor/src/providers/provider-factory.ts:23-29`).
- The child **already inherits the parent's environment**:
  `env: { ...process.env, ...(this.env ?? {}) }` (`child-process-subagent-runner.ts:116`), so the
  variable the reference names is already readable in the child with no new plumbing.

The gap is only that `createProviderProfile` copies the resolved value where it could pass the
reference.

## Prior Art Research

### Observed common behavior

1. **Credentials reach a locally spawned stdio child through the environment, and the stored
   configuration holds a reference rather than the secret.** Claude Code registers a stdio MCP server
   with `claude mcp add --env AIRTABLE_API_KEY=YOUR_KEY --transport stdio airtable -- …`, and its
   `.mcp.json` supports `${VAR}` expansion explicitly so that teams can "share configurations while
   maintaining flexibility for machine-specific paths and sensitive values like API keys" — expansion
   is documented for the `env` block itself. The persisted artifact therefore names the variable; the
   value is supplied by the environment at spawn time.
   [Claude Code — MCP: adding a stdio server with `--env`](https://code.claude.com/docs/en/mcp),
   [Claude Code — Environment variable expansion in `.mcp.json`](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json)
2. **The MCP specification treats a credential that crosses a boundary it was not issued for as an
   anti-pattern, and names log leakage and local interception as the acquisition routes it is
   defending against.** Its normative rule — "MCP servers **MUST NOT** accept any tokens that were not
   explicitly issued for the MCP server" — is narrower than this case (it governs OAuth audience, not
   a parent handing its own key to its own child), so it is cited as directional rather than binding.
   The directly applicable part is its scope-minimization analysis, which lists "log leakage, memory
   scraping, or local interception" as how a credential is obtained and frames the mitigation as
   reducing the blast radius of each additional copy.
   [MCP — Security Best Practices: Token Passthrough](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices),
   [MCP — Security Best Practices: Scope Minimization](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)
3. **The repository has already adopted this convention internally.** `agent-core` owns
   `ENV_REFERENCE_PREFIX = '$ENV:'` with `formatEnvReference` / `resolveEnvReference`
   (`packages/agent-core/src/utils/env-ref.ts`), provider defaults ship references rather than values
   (`DEFAULT_DEEPSEEK_PROVIDER_API_KEY_REFERENCE`, `DEFAULT_QWEN_PROVIDER_API_KEY_REFERENCE`), and the
   org policy names plaintext storage as the thing to forbid. The subagent spawn path is the outlier,
   not the precedent.

### Constraint for Robota

- The child must still construct the product's own provider definition — ARCH-021's premise — so
  proxying inference from the parent (MCP-style sampling) is not available: it would lose exact model
  selection and demote hints to advisory.
- The change must not break a profile that legitimately holds a literal key: some providers are
  configured that way and the run must still work.
- The environment already crosses the boundary, so the fix must not add a new transport for the
  secret; it must stop adding a second copy to one that carries structured data.

## Architecture Review

### Affected Scope

- `packages/agent-subagent-runner/src/child-process-subagent-runner.ts` — `createProviderProfile`, the
  single site that copies the credential into the payload.
- `packages/agent-interface-transport/src/background-task-contracts.ts` — `ISerializableProviderProfile`
  documentation of which field is preferred (no shape change; both fields already exist).
- `packages/agent-executor/src/providers/provider-factory.ts` — `resolveProfileApiKey`, the consumer;
  verified to already handle both forms.
- `packages/agent-subagent-runner/docs/SPEC.md` — the runner's documented start-payload contract.
- `scripts/harness/` — a scan that fails when a plaintext credential can reach the start payload.

### Alternatives Considered

1. **Pass the credential through the child's `env` option and drop the payload field entirely.**
   Pro: the secret leaves the structured payload completely; matches the Claude Code `--env` shape
   exactly.
   Con: the runner would have to invent a variable name for a key that arrived as a literal, and the
   child would then read a variable the product never declared — a name collision hazard, and a second
   naming authority for something the settings profile already names.
2. **Prefer the reference: emit `apiKeyEnv` (or keep the `$ENV:` reference in `apiKey`) whenever the
   source config expresses one, and only fall back to the literal when the profile genuinely holds
   one.**
   Pro: uses the two fields the contract already declares and the resolver already reads; no new
   naming authority; the common configuration stops putting a secret on the wire; the literal case
   keeps working.
   Con: it does not _eliminate_ the plaintext case — a profile holding a literal still sends a
   literal. That residue must be made visible rather than left implicit.
3. **Refuse to spawn a child-process subagent when the resolved credential is plaintext.**
   Pro: closes the case completely and fails loudly.
   Con: turns a default-permitted configuration into a hard failure, breaking working installations
   for a posture improvement the user did not ask for; the repository's own policy makes plaintext a
   _policy_ decision (`requireApiKeyFromEnv`), so refusing unconditionally would override an owner's
   explicit choice.
4. **Encrypt or redact the field in transit.**
   Pro: no behavioral change for any profile.
   Con: the child must decrypt it, so the key material moves rather than shrinks; this is obfuscation
   presented as confinement, and would make the next reader believe the credential is confined when it
   is not.

### Decision

Choose alternative 2, with the residue from its Con made mechanical rather than implicit, and with
alternative 3's refusal available only under the existing `requireApiKeyFromEnv` policy.

The trade-off that drives it: the defect is that the spawn path **discards an indirection the rest of
the repository already uses**, and the smallest change that restores it is to stop resolving the
reference before serializing. Alternative 1 is rejected because it makes the runner a second naming
authority for a variable the settings profile already names — the "hand-synchronised second source"
shape this repository rejects elsewhere. Alternative 3 is rejected as the default because plaintext
storage is an owner policy decision with an existing flag; honouring that flag on the spawn path is
correct, overriding it is not. Alternative 4 is rejected outright: it changes what a reader believes
without changing what an attacker can reach.

Two deliverables, and the second is the load-bearing one:

- `createProviderProfile` passes the reference through instead of the resolved value.
- A scan proves no path can place a resolved plaintext credential into a serialized payload without
  the org policy having been consulted — because fixing this one call site does not prevent the next
  serializer from doing the same thing, and the repository's rule is that an instance fix never closes
  a recurring class.

Extending `requireApiKeyFromEnv` to the spawn path is in scope: the policy's stated meaning is "API
keys must be stored as env references, not plaintext", and a spawn path that transmits the plaintext
is inside that sentence even though the current enforcement site is not.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — every consumer of `ISerializableProviderProfile` inspected
      (`agent-executor/providers/provider-factory.ts`, `agent-executor/background-tasks/types.ts`,
      `agent-interface-transport`, `child-process-subagent-ipc.ts`, `child-process-subagent-worker.ts`);
      the in-process runner path confirmed not to serialize, and `resolveProfileApiKey` confirmed to
      already accept both credential forms so no consumer change is required
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

One declared fallback: when the resolved provider config holds a literal credential and
`requireApiKeyFromEnv` is not set, the payload still carries that literal. This is sanctioned because
refusing would break a configuration the repository's own policy permits by default, and it is not
silent — the scan records the case and the org policy is the documented way to forbid it. The call
site carries `// allow-fallback: <reason>` per the mechanical floor.

## Solution

1. Change `createProviderProfile` to prefer the indirection: when the source provider config expresses
   its credential as a `$ENV:` reference, pass that reference through unresolved (or populate
   `apiKeyEnv`) rather than emitting a resolved value.
2. Consult `requireApiKeyFromEnv` on the spawn path: when the policy is set and the resolved
   credential is plaintext, refuse to spawn with the policy's own violation message and admin contact,
   rather than transmitting it.
3. Add a scan that fails when a serialized provider profile can be constructed from a plaintext
   credential without a policy consultation, and register it in the scan runner.
4. Update `agent-subagent-runner`'s SPEC to state which credential form the start payload carries.
5. Prove the change by observing the payload, not by reading the diff: assert on the message the
   runner actually sends.

## Affected Files

- `packages/agent-subagent-runner/src/child-process-subagent-runner.ts`
- `packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`
- `packages/agent-subagent-runner/docs/SPEC.md`
- `packages/agent-interface-transport/src/background-task-contracts.ts`
- `scripts/harness/scan-credential-serialization.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/scan-credential-serialization.test.mjs`
- `.agents/tasks/SEC-009-subagent-ipc-start-payload-carries-apikey.md`

## Completion Criteria

- [ ] TC-01: Given a provider config whose `apiKey` is `$ENV:OPENAI_API_KEY`, the start payload the
      runner sends contains the string `$ENV:OPENAI_API_KEY` and does not contain the value of that
      environment variable.
- [ ] TC-02: Given the same config, the spawned worker constructs a provider whose resolved key equals
      the environment variable's value — the run still works.
- [ ] TC-03: Given a provider config holding a literal credential and `requireApiKeyFromEnv` set, the
      runner refuses to spawn and the error names the policy and the admin contact.
- [ ] TC-04: Given a provider config holding a literal credential and no policy set, the run proceeds
      and the declared fallback site carries an `allow-fallback` annotation the fallback scan accepts.
- [ ] TC-05: The new scan exits non-zero on a fixture that serializes a resolved credential without a
      policy consultation, and exits 0 on the repository's own sources.
- [ ] TC-06: `pnpm harness:scan` exits 0 with the new scan registered and reporting the count of
      serialization sites it examined.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                 | Notes                                                                                                |
| ----- | ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TC-01 | Unit test                | Vitest spy on the IPC send, asserting on the serialized payload contents        | Asserts on the wire message, not on the function's return, so a later re-resolution would still fail |
| TC-02 | Process integration test | Vitest driving the real child-process runner with a fixture provider definition | Proves the indirection is resolvable in the child, which is the half a payload assertion cannot show |
| TC-03 | Unit test                | Vitest with `IOrgPolicy.requireApiKeyFromEnv` set and a plaintext profile       | Red-first: currently the policy is not consulted on this path at all                                 |
| TC-04 | Unit test                | Vitest default-policy case plus `scan-no-fallback` over the annotated site      | Guards the declared fallback from becoming an undeclared one                                         |
| TC-05 | Unit test                | Vitest fixture sources for the new scan (violating and compliant)               | Red-first: the scan must reject the fixture before the call site is changed                          |
| TC-06 | CI pipeline smoke test   | `pnpm harness:scan`                                                             | Proves registration and dispatch, and the examined-size report the repository requires of a scan     |

## User Execution Test Scenarios

The first version of this section said "not applicable — nothing user-visible changes." Writing the
scenario is what refuted that, and the refutation is the item's most important finding: **the fix as
first merged did not work on the real path.** `resolveProviderCredentialEnvRefs` recorded the
variable name during `$ENV:` resolution, but `resolveActiveProviderProfile` projects
`IResolvedConfig['provider']` field by field and was not copying `apiKeyEnv` — so the resolved config
the runner serializes still held only the secret. The unit test passed because it HAND-BUILT the
resolved config and therefore never executed the projection that was dropping the field.

That is why this gate is not "not applicable": the observable that distinguishes fixed from broken
exists, it is reachable through the published SDK, and skipping it is exactly what let a non-working
fix be reported as complete.

**Scenario — a `$ENV:` credential does not cross the subagent process boundary.**
`agent-executable`. Prerequisites: none — no live credentials, no network, no external service. The
scenario writes its own settings file and its own echo worker, sets the referenced variable itself,
and drives the PUBLISHED `@robota-sdk/agent-subagent-runner` barrel with a config produced by the
real `loadConfig`. The observable is the provider profile **as the child process received it over
IPC**, echoed back by the worker — a parent-side assertion would still pass if the value were
re-resolved just before `send`.

Command:

```bash
pnpm --filter robota-scratch run run src/sec-009-end-to-end.ts
```

Expected observable result (exit code 0):

- `loadConfig` reports `provider.apiKeyEnv` equal to the variable name
- the profile the child received carries `apiKeyEnv` and no `apiKey`
- the secret string appears nowhere in the serialized message

Cleanup: the temp home and worker are disposable; the child exits on its own after replying.

**Evidence (run 2026-08-17, against the completed implementation):**

```
loadConfig → provider.apiKeyEnv = SEC_009_E2E_KEY
child received providerProfile = {"profileName":"openai","type":"openai","model":"m","apiKeyEnv":"SEC_009_E2E_KEY"}
carries reference: true
secret absent from the whole message: true
PASS
```

Red-proof of the scenario itself — with the one-line projection in `resolveActiveProviderProfile`
removed (the state this item shipped in before the gate was run), the secret crosses in plaintext:

```
loadConfig → provider.apiKeyEnv = undefined
child received providerProfile = {"profileName":"openai","type":"openai","model":"m","apiKey":"sk-secret-that-must-not-cross"}
carries reference: false
secret absent from the whole message: false
FAIL
```

Credential probe (recorded because a capability-absence claim requires one): `env` carries no
`ANTHROPIC_*`, `OPENAI_*`, `GOOGLE_*`, `DEEPSEEK_*`, or `QWEN_*` variable, `~/.robota/settings.json`
does not exist, and the repository has no `.env`. None were needed — the scenario was restructured
toward a provider-free observable, which the rule prefers over stating a credential prerequisite.

Durable engineering artifacts backing the same behavior:
`packages/agent-framework/src/__tests__/config-loader.test.ts` (the two SEC-009 cases, which assert
through `loadConfig` precisely because the hand-built variant did not catch this) and
`packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`
(`ChildProcessSubagentRunner — credential on the wire (SEC-009)`), driven by the `echo-profile` mode
in `packages/agent-subagent-runner/src/__tests__/fixtures/subagent-worker-fixture.mjs`.

## Tasks

- [ ] `.agents/tasks/SEC-009-subagent-ipc-start-payload-carries-apikey.md` — problem record exists;
      implementation begins after GATE-APPROVAL

## Evidence Log

### [IMPLEMENTED] — ✅ | 2026-08-17

Executed under the owner's standing instruction of this session, recorded verbatim:
"너가 제안한 1위부터 5위 까지 작업을 모두 진행해서 완료해줘". Each item's premise was
independently reproduced against the code before any change (see the Problem section's
measurements), and each change is reversible and internal to this repository.

Worse than the document assumed: config loading resolves `$ENV:` into the secret and discards the variable name, so plaintext crossed on EVERY configuration, not only profiles storing a literal. Fix records the variable name at resolution and sends the reference. Tests assert on the message the child actually received. 16 runner tests, 117 scans.

### Gate finding — the fix was incomplete when first merged (2026-08-17)

Recorded here because the process lesson matters more than the patch: this item was reported
complete on the strength of a unit test that constructed the object under test. Running the
user-execution gate — the step that drives the real entry point — is what found that
`resolveActiveProviderProfile` never copied `apiKeyEnv`, so on every real configuration the runner
still serialized the plaintext credential. `IResolvedConfig['provider']` is built field by field, and
a field the type system did not know about was therefore silently not copied; the corrective change
adds `TEnvResolvedSettings` / `TEnvResolvedProviderProfile` in `config-types.ts` so the derived field
is declared and the projection cannot drop it unnoticed again.

### [PIPELINE NOT FOLLOWED] — recorded 2026-08-17

Stated as a fact, not as a gate verdict — the actor who did the work may not judge it.

This document did not pass GATE-WRITE → GATE-APPROVAL before implementation. The work was
implemented first, under the owner's standing instruction quoted above, and this plan was written
alongside it. The gate catalogue is explicit about what that means: GATE-APPROVAL's NON-COMPLIANCE
trigger is _"Implementation work (file edits, code commits) was started before this gate ran."_ It
was.

So the document cannot legitimately be advanced to `done/` by running the gates now. A PASS recorded
today would assert an ordering that did not happen, and a status of `done` reached that way is a
worse record than a status of `draft` — it would read as a plan that was approved and then built,
which is not what occurred.

It stays at `status: draft` deliberately. The implementation is real, merged, and verified — the
evidence above and the `## User Execution Test Scenarios` section record it — but the PLAN's
lifecycle stopped where the process actually stopped.

**To dispose of this properly**, an owner has two options, and neither is the agent's to take:

- run `backlog-gate-guard` and let it record the NON-COMPLIANCE, closing the document on an accurate
  verdict; or
- accept the work as delivered outside the pipeline and mark the document `rejected` (which
  `spec-workflow.md` defines as "closed deliberately; not a gate FAIL"), since the plan it holds was
  never the thing that authorized the work.

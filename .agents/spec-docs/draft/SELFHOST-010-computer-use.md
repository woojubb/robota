---
status: draft
type: BEHAVIOR
tags: [computer-use, browser, tool, permissions, agent-tools, selfhost]
---

# SELFHOST-010 (EPIC): computer / browser use — neutral perceive→act tool + driver port, approval-gated, with takeover (v1)

## Problem

Promotes backlog [SELFHOST-010](../../backlog/SELFHOST-010-computer-use.md) toward [VISION.md](../../../VISION.md).
Concrete symptom: when Robota develops Robota, the agent can drive files and shells (`Read`/`Write`/`Edit`/`Shell`
in `agent-tools`) but has **no way to perceive and operate a GUI or browser** — it cannot look at a rendered page,
click a button, fill a field, or complete a login. Every self-hosting task that ends at a web UI (inspecting a
deployed docs site, driving an OAuth consent screen, exercising the app's own web surface) dead-ends. A
vision-driven control loop (screenshot → reason → click/type) is a first-class capability in competitive agents
(OpenAI's Computer-Using-Agent, Nous Hermes web control) and is **entirely absent in Robota**.

The capability is also the most **dangerous** tool the agent could hold: a click or a keystroke against a live
target is an irreversible, real-world side effect, and an untrusted page can attempt to steer the loop
(prompt injection → "click Transfer"). So v1 must ship the mechanism **gated by the permission system Robota
already has** — never a new, weaker approval path — and must never auto-run a mutating action against an
untrusted target.

## Prior Art Research

From product documentation:

- **OpenAI Computer-Using-Agent / `computer_use` tool** (<https://developers.openai.com/api/docs/guides/tools-computer-use>,
  <https://openai.com/index/computer-using-agent/>): a loop of **screenshot → model reasons → emits an action**
  (`click`, `double_click`, `type`, `keypress`, `scroll`, `drag`, `wait`); the environment executes the action and
  returns a **fresh screenshot**. The model does not see the DOM — it perceives pixels. The docs single out two
  safety mechanisms: the model raises **`pending_safety_checks`** the caller must acknowledge before **significant
  actions** run, and a human **takeover** for sensitive input (credentials/payment) where the agent stops acting.
- **Nous Hermes full web control** (<https://hermes-agent.nousresearch.com/docs/>): search/browse/vision web control
  driving a real browser on the user's behalf, same perceive→act shape.

**Common shape** across both: (1) a **perceive-screenshot → typed-action** contract, not DOM scripting;
(2) each action returns a new screenshot so the model re-perceives; (3) **significant (mutating) actions are
approval-gated**; (4) a **human takeover** for credential entry that suspends the agent's action loop.

**Robota constraint / delta.** Robota already owns two of these four as generic mechanisms and must not
re-invent them:

- **Approval is not a bespoke tool concern.** OpenAI models it as a tool-specific `pending_safety_checks`
  acknowledgement. Robota has a general, mode-driven gate — `MODE_POLICY` in
  `agent-core/src/permissions/permission-mode.ts` + `PermissionEnforcer.wrapToolWithPermission`
  (`agent-session/src/permission-enforcer.ts`) — that already blocks every mutating tool (`Shell`/`Write`/`Edit`
  are `approve`) until a human decides. A computer-use mutation is exactly this class of action, so it **reuses
  that path** (register the action tool as `approve`); it must NOT introduce a second approval mechanism.
- **The driver is environment-bound and must stay out of the shared core.** A real screen/browser driver needs a
  heavy environment (Playwright/CDP, an OS automation SDK, or a hosted CUA runtime). Robota already solved
  "inject a heavy, environment-bound capability behind a duck-typed adapter port" for sandboxes — `ISandboxClient`
  in `agent-tools/src/sandbox/types.ts`, with `E2BSandboxClient` duck-typing the E2B SDK via a locally-declared
  `IE2BSandboxAdapter` (zero `@e2b` import) and the concrete sandbox supplied by the surface. The computer-use
  **driver mirrors that precedent exactly**.
- **Takeover is a loop-suspension, not a permission verdict.** Robota's enforcement model already names the
  "halt-for-user" loop-back shape ([enforcement-architecture.md](../../rules/enforcement-architecture.md)); takeover
  reuses it (suspend the action loop, hand the target env to the human) rather than inventing a pause primitive.

## Architecture Review

### Affected Scope

- **`agent-tools`**: the computer-use **driver port + perceive/action-contract types** live HERE
  (`src/computer-use/types.ts`), **mirroring the sandbox precedent** (`ISandboxClient` / `ISandboxToolOptions` in
  `agent-tools/src/sandbox/types.ts`) — NOT a new interface package. `createComputerTool({ driver })` mirrors
  `create*Tool(options)`. **A neutral FAKE driver** (`FakeComputerDriver`, records actions + returns canned
  screenshots) also lives HERE (`src/computer-use/`), mirroring `InMemorySandboxClient` — it is the test double, not
  a real driver. **A duck-typed REFERENCE adapter** (`PageComputerDriver`, implementing `IComputerDriver` by
  duck-typing a browser-page-shaped object via a locally-declared `IBrowserPageAdapter`) also lives HERE, mirroring
  `E2BSandboxClient`/`IE2BSandboxAdapter`: it imports **no** heavy browser SDK — the surface passes the real page
  object. So agent-tools carries the port + a fake + a zero-dependency reference adapter, and **no environment**.
- **`agent-core` permissions**: register a single new known tool name `Computer` in `TKnownToolName` +
  `MODE_POLICY` (`permission-mode.ts`), decided **exactly like `Shell`** — `deny` in `plan`, `approve` in `default`
  AND `acceptEdits` (a GUI mutation is not a file edit, so `acceptEdits`' edit-auto does not cover it), `auto` only
  in `bypassPermissions`. This is the whole permission change: **no new gate, no new enforcer** — the existing
  `evaluatePermission` → `PermissionEnforcer` path now covers computer-use for free.
- **assembly threading**: the driver is threaded through the assembly layer exactly as `sandboxClient` is
  (`ICreateDefaultToolsOptions` / `createDefaultTools` in `agent-framework/src/assembly/create-tools.ts`), with the
  **product (`agent-cli`/`apps/agent-app`) supplying the concrete driver + target env**. `createComputerTool`
  **joins the default tool set adapter-gated**, mirroring how the sandbox-aware tools receive `sandboxClient`
  through `createDefaultTools(options)`: with no driver the tool is **absent/no-op — there is NO host fallback**
  (unlike Read/Write, there is no safe library-side "local" screen to fall back to), so a sibling surface reuses the
  shared core without a library-side environment choice.
- **Takeover**: the action contract carries a `takeover` action; the driver port exposes optional
  `beginTakeover()`/`endTakeover()` the surface implements (surface the real window, block perception). Executing
  `takeover` **suspends the action loop** (the halt-for-user shape) until the human signals resume; perception is
  paused for its duration so no screenshot captures the typed secret.
- **Extraction trigger:** extract the port/types to a new `agent-interface-computer` package at a later phase **iff**
  drivers become a third-party-installable family (like `agent-provider-*`) — not before (avoids premature
  publish-registry/project-structure ceremony for a non-family), exactly as SELFHOST-003 defers its interface split.

### Alternatives Considered

1. **Driver port + action-contract types folded into `agent-tools` (mirror the sandbox port); one `Computer`
   action tool in `agent-tools`; a neutral `FakeComputerDriver` (mirror `InMemorySandboxClient`) + a zero-dep
   duck-typed `PageComputerDriver` reference adapter (mirror `E2BSandboxClient`); significant actions gated by the
   EXISTING `MODE_POLICY`/`PermissionEnforcer` as `approve`; takeover = halt-for-user loop suspension (CHOSEN).**
   - ✅ Correct placement (mirrors the endorsed sandbox precedent, not a new interface package); neutral (no
     environment in libs — the reference adapter duck-types like `E2BSandboxClient` and imports no browser SDK);
     reuses the one approval path so there is a single, auditable gate for all mutating tools; takeover reuses the
     named halt-for-user shape; the driver is surface-injected so sibling surfaces reuse the shared core.
   - ❌ A single `Computer` tool gives one tool-level permission decision, so **pure perception (`screenshot`) and a
     mutation (`click`) share the tool's `approve` verdict** unless the surface allow-lists `Computer(screenshot)`
     → `auto`; the read/act split is coarser than `Read`(auto) vs `Write`(approve). Stated, not hidden (see
     Validated Recommendation); the allow-list pattern already supports the refinement.
2. **A bespoke computer-use "safety check / acknowledgement" flow inside the tool (port OpenAI's
   `pending_safety_checks` literally).**
   - ✅ Matches the reference API one-to-one; per-action granularity for free.
   - ❌ Invents a **second approval mechanism** parallel to `PermissionEnforcer` — two places a human sign-off can
     live, two things to keep in sync, and the mode system (`plan` should forbid GUI mutation, `bypass` should
     auto) would not govern it. Directly violates the task constraint "do NOT invent a new gate" and the
     single-SSOT principle. REJECTED.
3. **Bake a concrete browser driver (Playwright/CDP) into `agent-tools`.**
   - ✅ One turnkey impl; no surface wiring.
   - ❌ Heavy environment dependency + a target-env choice inside `packages/`; breaks library neutrality and the
     duck-typed-adapter precedent (`E2BSandboxClient` deliberately imports no `@e2b`). A screen driver is inherently
     environment-bound, so it belongs in the surface. REJECTED.

### Decision

Adopt (1): the computer-use driver port + perceive/action-contract types live IN `agent-tools`
(`src/computer-use/types.ts`, mirroring `ISandboxClient` in `sandbox/types.ts`) — NOT a new interface package; a
single neutral `createComputerTool({ driver })` in `agent-tools`, joining the default tool set adapter-gated
(absent driver → tool omitted, no host fallback); a neutral `FakeComputerDriver` test double (mirror
`InMemorySandboxClient`) and a zero-dependency duck-typed `PageComputerDriver` reference adapter (mirror
`E2BSandboxClient`/`IE2BSandboxAdapter`) ALSO in `agent-tools`; the driver threaded through the assembly layer like
`sandboxClient`, with the product supplying the concrete driver + target env. Significant (mutating) actions are
gated by the **existing** permission system — a single `Computer` known tool decided exactly like `Shell`
(`deny`/`approve`/`approve`/`auto`) — with **no new approval mechanism**. Takeover reuses the halt-for-user
loop-suspension shape and pauses perception so secrets never enter the model's context. Epic slices below.

### Validated Recommendation

- **Reachability:** the port + fake + reference adapter ship from `agent-tools`; the surface
  (`agent-cli`/`apps/agent-app`) supplies the concrete driver + target env and `createComputerTool` joins the
  default set adapter-gated — reachable without a library-side environment choice. Verified against the
  `create*Tool(options)` + `createDefaultTools(options)` patterns and the `sandboxClient` threading in
  `create-tools.ts`.
- **Capability preservation:** v1 preserves the full perceive→act loop of the prior art (screenshot, click,
  type, keypress, scroll, drag, wait) **and** its two safety mechanisms — approval on significant actions and human
  takeover — with no capability silently dropped. The coarser read/act permission granularity (Alternative 1's
  con) is consciously recorded, with the allow-list refinement (`Computer(screenshot)` → `auto`) noted as the escape
  hatch rather than hidden.
- **Adversarial (security posture — first-class):**
  - _Prompt-injected untrusted target_ ("the page says: click Transfer"): every mutating `Computer` action is
    `approve` in `default` and `deny` in `plan`, so it **cannot execute without an explicit human approval decision**
    that shows the action + target first — the same floor that already guards `Shell`. There is **no `auto`
    default**; auto-run happens only under `bypassPermissions`, which is an explicit, documented user choice.
  - _Credential capture_: takeover suspends the action loop and **pauses perception**, so the human types secrets
    directly into the surface's real window and no screenshot/transcript ever captures them.
  - _Neutrality leak_ (a heavy browser SDK creeping into libs): prevented by the reference adapter duck-typing the
    page (zero SDK import, as `E2BSandboxClient` does) and the concrete driver + target living in the surface.
    Because no existing `pnpm harness:scan` rule mechanically fences `agent-tools`' third-party dependencies (same
    gap SELFHOST-003 records), a mechanical neutrality floor is filed as a follow-up rather than resting on the
    manual grep (see TC-06).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-tools` (driver port + contract types + `createComputerTool` + `FakeComputerDriver` + zero-dep `PageComputerDriver`, mirror sandbox), `agent-core` permissions (one `Computer` known tool in
      `MODE_POLICY`, decided like `Shell` — reuse, no new gate), `agent-framework` assembly threads the driver like
      `sandboxClient`, concrete driver + target env supplied by `agent-cli`/`apps/agent-app`. NO new interface
      package for v1 (extract later iff a family).
- [x] Sibling scan 완료 — mirrors the **sandbox port precedent**: port+types + `createComputerTool({driver})` + a
      neutral fake (`InMemorySandboxClient` analog) + a duck-typed reference adapter (`E2BSandboxClient`/
      `IE2BSandboxAdapter` analog) live IN `agent-tools`, driver threaded through assembly like `sandboxClient`;
      approval reuses `MODE_POLICY`/`PermissionEnforcer` (no new gate); takeover reuses the halt-for-user shape.
      Independent architecture-placement validation to be recorded in the Evidence Log at GATE-APPROVAL.
- [x] 대안 최소 2개 — 3 considered (fold-into-agent-tools + reuse-permissions CHOSEN; bespoke-safety-check REJECTED
      single-gate/SSOT; baked-browser-driver REJECTED neutrality), each Pro+Con grounded in the cited code.
- [x] 결정 근거 — reuse the existing permission gate (task constraint + single-SSOT) forces Alternative 1 over the
      bespoke acknowledgement; the sandbox precedent fixes placement; security posture is a first-class Completion
      Criterion; GATE-APPROVAL pending.

## Solution

v1: computer-use driver port + perceive/action-contract types in `agent-tools/src/computer-use/types.ts` (mirror
`sandbox/types.ts`); a single `createComputerTool({ driver })` in `agent-tools`, joining the default tool set
adapter-gated; a neutral `FakeComputerDriver` (mirror `InMemorySandboxClient`) and a zero-dependency duck-typed
`PageComputerDriver` reference adapter (mirror `E2BSandboxClient`) in `agent-tools`; the driver threaded through the
assembly layer like `sandboxClient` (`ICreateDefaultToolsOptions.computerDriver`); one `Computer` known tool added
to `agent-core`'s `MODE_POLICY` decided like `Shell` (the ONLY permission change — reuse, no new gate); a `takeover`
action that suspends the action loop and pauses perception; concrete driver + target-env wiring supplied by the
surface (`agent-cli`/`apps/agent-app`).

**Perceive→act contract (neutral).** `IComputerDriver` exposes `screenshot()` (perceive) and the mutating actions
`click`/`doubleClick`/`type`/`keypress`/`scroll`/`drag`/`wait`, plus optional `beginTakeover()`/`endTakeover()`.
`createComputerTool` takes a single typed `action` argument, executes it via the driver, and returns the resulting
screenshot so the model re-perceives — the OpenAI/Hermes loop, expressed once, neutrally.

**Epic slices:** P1 (this) = driver port + contract + `createComputerTool` + `FakeComputerDriver` + `Computer`
permission wiring + assembly threading + adapter-gating. P2 = the zero-dep `PageComputerDriver` reference adapter +
takeover loop-suspension. P3 = concrete surface driver (browser via injected page/CDP) + target-env wiring in
`agent-cli`/`apps/agent-app`. P4 = the mechanical `agent-tools` neutrality floor (shared with SELFHOST-003's
follow-up) + optional per-action permission refinement (`Computer(screenshot)` → `auto` allow-list default).

## Affected Files

| File                                                                    | Change                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-tools/src/computer-use/types.ts` (new)                  | `IComputerDriver` port + perceive/action-contract types + `IComputerToolOptions { driver? }` (mirror `sandbox/types.ts`)                        |
| `packages/agent-tools/src/computer-use/fake-computer-driver.ts` (new)   | neutral `FakeComputerDriver` test double — records actions, returns canned screenshots (mirror `InMemorySandboxClient`)                         |
| `packages/agent-tools/src/computer-use/page-computer-driver.ts` (new)   | zero-dep duck-typed `PageComputerDriver` reference adapter + `IBrowserPageAdapter` (mirror `E2BSandboxClient`/`IE2BSandboxAdapter`)             |
| `packages/agent-tools/src/computer-use/computer-tool.ts` (new)          | `createComputerTool({ driver })` — perceive→act, returns post-action screenshot (mirror `create*Tool`)                                          |
| `packages/agent-tools/src/computer-use/index.ts` + `src/index.ts`       | export the port/types + fake + reference adapter + factory                                                                                      |
| `packages/agent-core/src/permissions/permission-mode.ts`                | add `Computer` to `TKnownToolName` + `MODE_POLICY` (`deny`/`approve`/`approve`/`auto`, like `Shell`) — the only gate change                     |
| `packages/agent-framework/src/assembly/create-tools.ts`                 | `ICreateDefaultToolsOptions.computerDriver?`; `createDefaultTools` adds `createComputerTool` adapter-gated (absent → omitted, no host fallback) |
| `packages/agent-cli/` / `apps/agent-app`                                | concrete driver + target-env wiring + takeover window surfacing (the port/fake/reference adapter come from agent-tools)                         |
| `packages/agent-tools/docs/SPEC.md`, `packages/agent-core/docs/SPEC.md` | record the driver port + the `Computer` permission entry                                                                                        |

## Completion Criteria

- [ ] TC-01: `createComputerTool` executes each perceive/action-contract action through the injected driver and
      returns the resulting screenshot; the action contract round-trips (unit test against `FakeComputerDriver`).
- [ ] TC-02: **a significant (mutating) `Computer` action is blocked until approved via the EXISTING
      `PermissionEnforcer`** — in `default` mode `evaluatePermission('Computer', …)` returns `approve` and the
      wrapped tool does not execute until the approval handler allows; in `plan` mode it returns `deny` (functional
      test through `PermissionEnforcer.checkPermission`, asserting NO new approval path is used).
- [ ] TC-03: **takeover suspends the action loop** — executing the `takeover` action halts further actions (the
      halt-for-user shape) until a resume signal, and perception is paused for its duration so no screenshot is
      captured while the human enters credentials (functional test).
- [ ] TC-04: the driver is threaded through the assembly layer (like `sandboxClient`) and `createComputerTool`
      joins the default set **adapter-gated** — **absent/no-op with no driver (no host fallback)** — while the
      product (`agent-cli`/`apps/agent-app`) supplies the concrete driver + target env (unit test on the assembly
      wiring + adapter-gating).
- [ ] TC-05: **a fake-driver unit test** proves swapping the driver needs no `agent-tools` change — `FakeComputerDriver`
      and a second stub driver both satisfy `IComputerDriver` and drive `createComputerTool` unchanged; the zero-dep
      `PageComputerDriver` reference adapter imports no heavy browser SDK (duck-types `IBrowserPageAdapter`).
- [ ] TC-06: **neutrality** — no environment/target content in `agent-tools`: the tool takes the driver + target env
      by injection; a code review / targeted grep confirms no browser SDK import and no concrete target (URL/host) in
      the package. This is a MANUAL floor today (same gap SELFHOST-003 records: no `pnpm harness:scan` rule fences
      `agent-tools`' third-party deps); per [enforcement-architecture.md](../../rules/enforcement-architecture.md)
      (every guardian needs a mechanical floor) a follow-up mechanical `agent-tools` neutrality floor is filed —
      neutrality does not rest on the manual grep alone.
- [ ] TC-07: **security posture (first-class)** — the agent never auto-runs a mutating action against a target
      without approval: in `default` and `plan` modes a `Computer` mutation is never executed without an explicit
      approval/deny decision (no `auto` default); auto-execution occurs only under `bypassPermissions` (asserted as
      an explicit, documented user choice). Falsifiable via a test that a mutating action under `default`/`plan` is
      not dispatched to the driver absent an approval.

## Test Plan

| TC    | Verification                                               | Type/Tool                                       |
| ----- | ---------------------------------------------------------- | ----------------------------------------------- |
| TC-01 | action contract round-trips through the driver             | vitest unit (FakeComputerDriver)                |
| TC-02 | mutating action gated via existing PermissionEnforcer      | functional test (checkPermission, no new gate)  |
| TC-03 | takeover suspends the loop + pauses perception             | functional test                                 |
| TC-04 | driver threaded via assembly + adapter-gated (no fallback) | vitest unit (assembly wiring)                   |
| TC-05 | driver swap needs no agent-tools change                    | fake-driver unit test                           |
| TC-06 | no environment/SDK in agent-tools                          | manual grep/review + follow-up mechanical floor |
| TC-07 | no auto-run of a mutation without approval                 | vitest unit (permission-mode + dispatch)        |

## Tasks

`.agents/tasks/SELFHOST-010*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Epic P1 (driver port + contract +
`createComputerTool` + `FakeComputerDriver` + `Computer` permission + assembly threading) / P2 (`PageComputerDriver`
reference adapter + takeover loop-suspension) / P3 (concrete surface driver + target-env wiring) / P4 (mechanical
neutrality floor + optional per-action permission refinement).

## Evidence Log

- 2026-07-17 — **draft authored.** Grounded in: the sandbox port precedent `ISandboxClient`/`ISandboxToolOptions`
  (`packages/agent-tools/src/sandbox/types.ts`), the neutral reference client `InMemorySandboxClient`
  (`in-memory-sandbox-client.ts`) and the zero-dep duck-typed adapter `E2BSandboxClient`/`IE2BSandboxAdapter`
  (`e2b-sandbox-client.ts`); the tool-factory + adapter-gating pattern `create*Tool(options)` +
  `createDefaultTools`/`ICreateDefaultToolsOptions` threading `sandboxClient`
  (`packages/agent-framework/src/assembly/create-tools.ts`) and the sandbox-gated `shell-tool.ts`; the permission
  system `MODE_POLICY`/`TKnownToolName`/`UNKNOWN_TOOL_FALLBACK` (`packages/agent-core/src/permissions/permission-mode.ts`),
  `evaluatePermission` (`permission-gate.ts`) and `PermissionEnforcer.wrapToolWithPermission`/`checkPermission`
  (`packages/agent-session/src/permission-enforcer.ts`); the halt-for-user loop-back shape
  ([.agents/rules/enforcement-architecture.md](../../rules/enforcement-architecture.md)); structure/style mirror the
  ENDORSED exemplar [SELFHOST-003](../todo/SELFHOST-003-codebase-index-rag.md). **GATE-APPROVAL pending** (independent
  proposal-reviewer + architecture-placement validation to be recorded here).
  </content>
  </invoke>

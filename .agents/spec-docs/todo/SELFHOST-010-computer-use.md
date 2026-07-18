---
status: approved
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
  are `approve`) until a human decides while auto-running read-only perception (`Read` is `auto`). That
  read-vs-mutate split is the repo's OWN endorsed precedent, so computer-use **mirrors it as two tools**: a
  perceive tool (`ComputerView`, `auto` like `Read`) and an act tool (`Computer`, `approve` like `Shell`). Both
  **reuse that path**; it must NOT introduce a second approval mechanism.
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
  `agent-tools/src/sandbox/types.ts`) — NOT a new interface package. The tool factory splits along the permission
  boundary — a perceive factory (`ComputerView`) and an act factory (`Computer`), or one
  `createComputerTool({ driver })` registering both tool names — mirroring `create*Tool(options)`; the typed action
  union stays in the driver contract, only the permission-bearing tool boundary splits. **A test-support scripted
  driver** (`ScriptedComputerDriver`, records actions + returns scripted screenshots) lives under the **`./testing`
  subpath** (`src/computer-use/testing/`, exported via the package's `./testing` entry — mirroring agent-core's
  `scripted-provider`), so it is test-support NEVER shipped in the package main entry, and is not a "fake" in
  production code. **A duck-typed REFERENCE adapter** (`PageComputerDriver`, implementing `IComputerDriver` by
  duck-typing a browser-page-shaped object via a locally-declared `IBrowserPageAdapter`) also lives HERE, mirroring
  `E2BSandboxClient`/`IE2BSandboxAdapter`: it imports **no** heavy browser SDK — the surface passes the real page
  object. So agent-tools carries the port + a zero-dependency reference adapter (+ a test-support scripted driver under
  the `./testing` subpath), and **no environment**.
- **`agent-core` permissions**: register TWO new known tool names in `TKnownToolName` + `MODE_POLICY`
  (`permission-mode.ts`), modeling read-vs-mutate as the repo already does (`Read` auto vs `Shell`/`Write`
  approve): a perceive tool `ComputerView` decided **exactly like `Read`** — `auto` in
  `plan`/`default`/`acceptEdits`/`bypassPermissions` (read-only perception, so it runs unapproved INCLUDING in
  `plan`, which is what makes read-only inspection of a deployed site possible in plan mode); and an act tool
  `Computer` decided **exactly like `Shell`** — `deny` in `plan`, `approve` in `default` AND `acceptEdits` (a GUI
  mutation is not a file edit, so `acceptEdits`' edit-auto does not cover it), `auto` only in `bypassPermissions`.
  This is the whole permission change: **no new gate, no new enforcer** — the existing `evaluatePermission` →
  `PermissionEnforcer` path now covers computer-use for free.
- **assembly threading**: the driver is threaded through the assembly layer exactly as `sandboxClient` is
  (`ICreateDefaultToolsOptions` / `createDefaultTools` in `agent-framework/src/assembly/create-tools.ts`), with the
  **product (`agent-cli`/`apps/agent-app`) supplying the concrete driver + target env**. The `ComputerView`/
  `Computer` tools **join the default tool set adapter-gated** on the driver, mirroring how the sandbox-aware tools
  receive `sandboxClient` through `createDefaultTools(options)` — but with one deliberate DIVERGENCE: `shell-tool.ts`
  with no `sandboxClient` **falls back to host `spawn`**, whereas computer-use with no driver is **absent/no-op —
  there is NO host fallback** (unlike Read/Write or Shell, there is no safe library-side "local" screen to fall back
  to). So "adapter-gated like `sandboxClient`" names the threading shape, NOT a literal mirror of its host-fallback;
  a sibling surface reuses the shared core without a library-side environment choice.
- **Takeover**: the action contract carries a `takeover` action; the driver port exposes optional
  `beginTakeover()`/`endTakeover()` the surface implements (surface the real window, block perception). Executing
  `takeover` **suspends the action loop** (the halt-for-user shape) until the human signals resume; perception is
  paused for its duration so no screenshot captures the typed secret.
- **Extraction trigger:** extract the port/types to a new `agent-interface-computer` package at a later phase **iff**
  drivers become a third-party-installable family (like `agent-provider-*`) — not before (avoids premature
  publish-registry/project-structure ceremony for a non-family), exactly as SELFHOST-003 defers its interface split.

### Alternatives Considered

1. **Driver port + action-contract types folded into `agent-tools` (mirror the sandbox port); a perceive/act
   SPLIT — a `ComputerView` perceive tool (`auto` like `Read`) + a `Computer` act tool (`approve` like `Shell`),
   both in `agent-tools`; a neutral `ScriptedComputerDriver` (mirror `InMemorySandboxClient`) + a zero-dep duck-typed
   `PageComputerDriver` reference adapter (mirror `E2BSandboxClient`); mutating actions gated by the EXISTING
   `MODE_POLICY`/`PermissionEnforcer` as `approve` while perception is `auto`; takeover = halt-for-user loop
   suspension (CHOSEN).**
   - ✅ Correct placement (mirrors the endorsed sandbox precedent, not a new interface package); neutral (no
     environment in libs — the reference adapter duck-types like `E2BSandboxClient` and imports no browser SDK);
     reuses the one approval path so there is a single, auditable gate for all mutating tools; the perceive/act
     split mirrors the repo's own `Read`(auto)-vs-`Write`/`Shell`(approve) precedent, so read-only perception runs
     unapproved (INCLUDING in `plan`) while every mutation stays gated; takeover reuses the named halt-for-user
     shape; the driver is surface-injected so sibling surfaces reuse the shared core.
   - ❌ Two tool names instead of one — a slightly wider known-tool surface, and the model must pick perceive vs
     act — but this is the same shape the repo already ships for `Read` vs `Write`/`Shell`, so it adds no new
     concept. (The rejected single-tool variant forced perception to inherit the mutation's `approve` verdict and,
     because `plan` = `deny` for `Computer`, made read-only inspection impossible in `plan` — the Problem's own
     "inspect a deployed docs site" scenario; the split removes that, so no per-action allow-list escape hatch is
     needed.)
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
neutral tool factory in `agent-tools` split along the permission boundary into a `ComputerView` perceive tool and a
`Computer` act tool, both joining the default tool set adapter-gated (absent driver → tools omitted, no host
fallback); a neutral `ScriptedComputerDriver` test double (mirror `InMemorySandboxClient`) and a zero-dependency
duck-typed `PageComputerDriver` reference adapter (mirror `E2BSandboxClient`/`IE2BSandboxAdapter`) ALSO in
`agent-tools`; the driver threaded through the assembly layer like `sandboxClient`, with the product supplying the
concrete driver + target env. Perception is gated by the **existing** permission system exactly like `Read`
(`ComputerView` = `auto`, so read-only inspection runs unapproved, including in `plan`); every mutating action is
gated exactly like `Shell` (`Computer` = `deny`/`approve`/`approve`/`auto`) — with **no new approval mechanism**.
Takeover reuses the halt-for-user loop-suspension shape and pauses perception so secrets never enter the model's
context. Epic slices below.

### Validated Recommendation

- **Reachability:** the port + reference adapter ship from `agent-tools` (+ a `/testing`-only scripted driver); the surface
  (`agent-cli`/`apps/agent-app`) supplies the concrete driver + target env and the `ComputerView`/`Computer` tools
  join the default set adapter-gated — reachable without a library-side environment choice. Verified against the
  `create*Tool(options)` + `createDefaultTools(options)` patterns and the `sandboxClient` threading in
  `create-tools.ts`.
- **Capability preservation:** v1 preserves the full perceive→act loop of the prior art (screenshot, click,
  type, keypress, scroll, drag, wait) **and** its two safety mechanisms — approval on mutating actions and human
  takeover — with no capability silently dropped. Read-vs-mutate permission granularity is modeled exactly as the
  repo already does for `Read` vs `Write`/`Shell` (perceive `auto`, act `approve`), so read-only inspection — the
  Problem's own "inspect a deployed docs site" scenario — works in `plan` mode without a per-action allow-list
  escape hatch.
- **Adversarial (security posture — first-class):**
  - _Prompt-injected untrusted target_ ("the page says: click Transfer"): perception (`ComputerView`) is `auto`
    like `Read`, but it only reads pixels — it cannot mutate. Every mutating `Computer` action is `approve` in
    `default` and `deny` in `plan`, so it **cannot execute without an explicit human approval decision** that shows
    the action + target first — the same floor that already guards `Shell`. There is **no `auto` default for
    mutation**; auto-run happens only under `bypassPermissions`, which is an explicit, documented user choice.
  - _Credential capture_: takeover suspends the action loop and **pauses perception**, so the human types secrets
    directly into the surface's real window and no screenshot/transcript ever captures them.
  - _Neutrality leak_ (a heavy browser SDK creeping into libs): prevented by the reference adapter duck-typing the
    page (zero SDK import, as `E2BSandboxClient` does) and the concrete driver + target living in the surface.
    Because no existing `pnpm harness:scan` rule mechanically fences `agent-tools`' third-party dependencies (same
    gap SELFHOST-003 records), a mechanical neutrality floor is filed as a follow-up rather than resting on the
    manual grep (see TC-06).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-tools` (driver port + contract types + `ComputerView`/`Computer` tool factory + `ScriptedComputerDriver` + zero-dep `PageComputerDriver`, mirror sandbox), `agent-core` permissions (TWO known tools in
      `MODE_POLICY` — `ComputerView` decided like `Read`, `Computer` decided like `Shell` — reuse, no new gate), `agent-framework` assembly threads the driver like
      `sandboxClient`, concrete driver + target env supplied by `agent-cli`/`apps/agent-app`. NO new interface
      package for v1 (extract later iff a family).
- [x] Sibling scan 완료 — mirrors the **sandbox port precedent**: port+types + `createComputerTool({driver})` + a
      test-support scripted driver under `./testing` (agent-core `scripted-provider` analog) + a duck-typed reference adapter (`E2BSandboxClient`/
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
`sandbox/types.ts`); a neutral tool factory in `agent-tools` split along the permission boundary — a `ComputerView`
perceive tool + a `Computer` act tool — both joining the default tool set adapter-gated; a neutral
`ScriptedComputerDriver` (mirror `InMemorySandboxClient`) and a zero-dependency duck-typed `PageComputerDriver`
reference adapter (mirror `E2BSandboxClient`) in `agent-tools`; the driver threaded through the assembly layer like
`sandboxClient` (`ICreateDefaultToolsOptions.computerDriver`); TWO known tools added to `agent-core`'s `MODE_POLICY`
— `ComputerView` decided like `Read` (`auto`) and `Computer` decided like `Shell`
(`deny`/`approve`/`approve`/`auto`) — the ONLY permission change (reuse, no new gate); a `takeover` action that
suspends the action loop and pauses perception; concrete driver + target-env wiring supplied by the surface
(`agent-cli`/`apps/agent-app`).

**Perceive→act contract (neutral).** `IComputerDriver` exposes `screenshot()` (perceive) and the mutating actions
`click`/`doubleClick`/`type`/`keypress`/`scroll`/`drag`/`wait`, plus optional `beginTakeover()`/`endTakeover()`.
The permission-bearing tool boundary splits in two — `ComputerView` calls `screenshot()` (a perceive with no action
argument), while `Computer` takes a single typed mutating `action` argument, executes it via the driver, and
returns the resulting screenshot so the model re-perceives — the OpenAI/Hermes loop, expressed once, neutrally. The
typed action union stays whole in the driver contract; only the tool boundary splits.

**Epic slices:** P1 (this) = driver port + contract + the `ComputerView`/`Computer` tool factory +
`ScriptedComputerDriver` + the two-tool permission wiring + assembly threading + adapter-gating. P2 = the zero-dep
`PageComputerDriver` reference adapter + takeover loop-suspension. P3 = concrete surface driver (browser via
injected page/CDP) + target-env wiring in `agent-cli`/`apps/agent-app`. P4 = the mechanical `agent-tools`
neutrality floor (shared with SELFHOST-003's follow-up). (The per-action allow-list refinement earlier parked here
is dropped — the perceive/act tool split makes it unnecessary; were finer per-action granularity ever wanted, note
that the allow-list does NOT support `Computer(screenshot)` today: `primaryArg` in `permission-gate.ts` returns
`undefined` in its `default` case for any unregistered tool, so a `Computer` case would have to be added to
`primaryArg` first — a one-line change, not zero-change.)

## Affected Files

| File                                                                              | Change                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-tools/src/computer-use/types.ts` (new)                            | `IComputerDriver` port + perceive/action-contract types + `IComputerToolOptions { driver? }` (mirror `sandbox/types.ts`)                                                                             |
| `packages/agent-tools/src/computer-use/testing/scripted-computer-driver.ts` (new) | test-support `ScriptedComputerDriver` (records actions, returns scripted screenshots) — under the `./testing` subpath, exported like agent-core's `scripted-provider`; NOT in the package main entry |
| `packages/agent-tools/src/computer-use/page-computer-driver.ts` (new)             | zero-dep duck-typed `PageComputerDriver` reference adapter + `IBrowserPageAdapter` (mirror `E2BSandboxClient`/`IE2BSandboxAdapter`)                                                                  |
| `packages/agent-tools/src/computer-use/computer-tool.ts` (new)                    | tool factory split along the permission boundary — a `ComputerView` perceive tool (`screenshot()`) + a `Computer` act tool (typed mutating action → post-action screenshot), mirror `create*Tool`    |
| `packages/agent-tools/src/computer-use/index.ts` + `src/index.ts`                 | export the port/types + reference adapter + the perceive/act factory (the scripted driver is exported from the `./testing` subpath only)                                                             |
| `packages/agent-core/src/permissions/permission-mode.ts`                          | add `ComputerView` (`auto` in every mode, like `Read`) AND `Computer` (`deny`/`approve`/`approve`/`auto`, like `Shell`) to `TKnownToolName` + `MODE_POLICY` — the only gate change                   |
| `packages/agent-framework/src/assembly/create-tools.ts`                           | `ICreateDefaultToolsOptions.computerDriver?`; `createDefaultTools` adds the `ComputerView`/`Computer` tools adapter-gated (absent → omitted, no host fallback)                                       |
| `packages/agent-cli/` / `apps/agent-app`                                          | concrete driver + target-env wiring + takeover window surfacing (the port + reference adapter (+ `/testing` scripted driver) come from agent-tools)                                                  |
| `packages/agent-tools/docs/SPEC.md`, `packages/agent-core/docs/SPEC.md`           | record the driver port + the `ComputerView`/`Computer` permission entries                                                                                                                            |

## Completion Criteria

- [ ] TC-01: the tool factory executes each perceive/action-contract action through the injected driver and returns
      the resulting screenshot — `ComputerView` round-trips `screenshot()` and `Computer` round-trips each mutating
      action (unit test against `ScriptedComputerDriver`).
- [ ] TC-02: **the perceive/act split is enforced through the EXISTING `PermissionEnforcer`** — perception is `auto`
      and executes without approval in EVERY mode: `evaluatePermission('ComputerView', …)` returns `auto` in `plan`
      AND `default` (so read-only inspection of a deployed site runs even in `plan` mode). A mutating action is
      gated: `evaluatePermission('Computer', …)` returns `approve` in `default` (and the wrapped tool does not
      execute until the approval handler allows) and `deny` in `plan` (functional test through
      `PermissionEnforcer.checkPermission`, asserting NO new approval path is used).
- [ ] TC-03: **takeover suspends the action loop** — executing the `takeover` action halts further actions (the
      halt-for-user shape) until a resume signal, and perception is paused for its duration so no screenshot is
      captured while the human enters credentials (functional test).
- [ ] TC-04: the driver is threaded through the assembly layer (like `sandboxClient`) and the `ComputerView`/
      `Computer` tools join the default set **adapter-gated** — **absent/no-op with no driver (no host fallback)** —
      while the product (`agent-cli`/`apps/agent-app`) supplies the concrete driver + target env (unit test on the
      assembly wiring + adapter-gating).
- [ ] TC-05: **a scripted-driver unit test** proves swapping the driver needs no `agent-tools` change — `ScriptedComputerDriver`
      and a second stub driver both satisfy `IComputerDriver` and drive the perceive/act factory unchanged; the
      zero-dep `PageComputerDriver` reference adapter imports no heavy browser SDK (duck-types `IBrowserPageAdapter`).
- [ ] TC-06: **neutrality** — no environment/target content in `agent-tools`: the tool takes the driver + target env
      by injection; a code review / targeted grep confirms no browser SDK import and no concrete target (URL/host) in
      the package. This is a MANUAL floor today (same gap SELFHOST-003 records: no `pnpm harness:scan` rule fences
      `agent-tools`' third-party deps); per [enforcement-architecture.md](../../rules/enforcement-architecture.md)
      (every guardian needs a mechanical floor) a follow-up mechanical `agent-tools` neutrality floor is filed —
      neutrality does not rest on the manual grep alone.
- [ ] TC-07: **security posture (first-class), unchanged floor** — the agent never auto-runs a mutating action
      against a target without approval: in `default` and `plan` modes a `Computer` mutation is never executed
      without an explicit approval/deny decision (no `auto` default); auto-execution occurs only under
      `bypassPermissions` (asserted as an explicit, documented user choice). The perceive/act split does NOT weaken
      this floor: `ComputerView` is `auto` like `Read` but only reads pixels — every mutating action stays
      `approve`/`deny`. Falsifiable via a test that a mutating action under `default`/`plan` is not dispatched to the
      driver absent an approval, AND that auto-perception dispatches only `screenshot()`, never a mutating action.
- [ ] TC-08: **read-only inspection works in `plan` mode** (the Problem's own "inspect a deployed docs site"
      scenario) — with mode `plan`, `ComputerView` perception executes and returns a screenshot without any
      approval, while a `Computer` mutation in the same mode is denied (functional test asserting the perceive path
      is reachable in `plan`).

## Test Plan

| TC    | Verification                                               | Type/Tool                                       |
| ----- | ---------------------------------------------------------- | ----------------------------------------------- |
| TC-01 | perceive + each mutating action round-trip through driver  | vitest unit (ScriptedComputerDriver)            |
| TC-02 | perceive `auto` (incl. plan); mutation gated via enforcer  | functional test (checkPermission, no new gate)  |
| TC-03 | takeover suspends the loop + pauses perception             | functional test                                 |
| TC-04 | driver threaded via assembly + adapter-gated (no fallback) | vitest unit (assembly wiring)                   |
| TC-05 | driver swap needs no agent-tools change                    | scripted-driver unit test                       |
| TC-06 | no environment/SDK in agent-tools                          | manual grep/review + follow-up mechanical floor |
| TC-07 | no auto-run of a mutation without approval (floor)         | vitest unit (permission-mode + dispatch)        |
| TC-08 | read-only inspection reachable in `plan` mode              | functional test (perceive in plan)              |

## Tasks

[`.agents/tasks/SELFHOST-010-P1.md`](../../tasks/SELFHOST-010-P1.md) — created at GATE-IMPLEMENT; P1 slices S1–S6
(port+contract+ScriptedComputerDriver → tool factory → permission wiring → takeover → assembly+gating → swap/neutrality+docs)
mapped to TC-01..08. Epic P1 (driver port + contract + `ComputerView`/`Computer` tool factory + `ScriptedComputerDriver` +
the two-tool permission wiring + assembly threading) / P2 (`PageComputerDriver` reference adapter + takeover
loop-suspension + **agent-run browser verification**) / P3 (concrete surface driver + target-env wiring) / P4
(mechanical neutrality floor).

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
- 2026-07-17 — **GATE-APPROVAL RE-REVIEW → REVISE, applied (iteration 1).** Direction (tool+driver in `agent-tools`
  mirroring the sandbox port, reuse of the existing permission gate, no-host-fallback, takeover, security floor)
  ENDORSED; one decision changed. **Split the single coarse `Computer` known tool into a perceive/act pair.** The
  single tool forced perception to inherit the mutation's `approve` verdict and — because `plan` = `deny` for
  `Computer` — made read-only inspection (the Problem's own "inspect a deployed docs site" scenario) impossible in
  `plan`, contradicting the repo's OWN endorsed `Read`(auto)-vs-`Write`/`Shell`(approve) precedent. Applied: (1) TWO
  known tools in `TKnownToolName` + `MODE_POLICY` — `ComputerView` `auto` in every mode (mirror `Read`) and `Computer`
  `deny`/`approve`/`approve`/`auto` (mirror `Shell`, unchanged); the tool factory splits along the permission
  boundary while the typed action union stays whole in the driver contract. (2) Dropped the P4 per-action allow-list
  refinement (redundant after the split); recorded that the allow-list does NOT support `Computer(screenshot)` today
  — `primaryArg` in `permission-gate.ts` returns `undefined` in its `default` case for any unregistered tool, so a
  `Computer` case would need adding first (a one-line change, NOT zero-change). (3) Corrected two statements — the
  allow-list refinement is not zero-change, and made explicit that computer-use's no-host-fallback DIVERGES from
  `sandboxClient`'s host-fallback (`shell-tool.ts` falls back to host `spawn`), so "adapter-gated like `sandboxClient`"
  names the threading shape, not a literal mirror. (4) Updated TC-02 (perceive `auto`, incl. `plan`; mutation
  `deny`/`plan`, `approve`/`default`) and TC-07 (floor unchanged; the split does not weaken it), and ADDED TC-08
  asserting read-only inspection works in `plan` mode. Everything else kept (placement in `computer-use/`, no
  interface package for v1, `ScriptedComputerDriver` + zero-dep `PageComputerDriver`, no-host-fallback omission, takeover
  halt-for-user + perception pause, TC-06 manual floor + filed mechanical follow-up).
- 2026-07-17 — **GATE-APPROVAL iteration 2: ENDORSE** (independent proposal-reviewer). The perceive/act split is
  applied consistently and every load-bearing premise verified: the `Read`(auto-in-all-modes) and
  `Shell`(deny/approve/approve/auto) `MODE_POLICY` rows the two tools mirror are exact; `acceptEdits`=`approve` for
  `Computer` is sound (a GUI mutation is not a file edit, and `Shell` is likewise `approve` there); the allow-list
  genuinely does NOT match `Computer(screenshot)` today (`primaryArg` `default`→`undefined`), correctly noted as a
  one-line change since P4 was dropped; the no-host-fallback divergence from `sandboxClient` is explicit, not a
  literal mirror; the security floor is preserved (every mutating action `approve`/`deny`, only `bypassPermissions`
  auto-runs; auto-perception mirrors `Read` and cannot mutate). TC-02/07/08 route through the existing
  `evaluatePermission`→`PermissionEnforcer` path — no second gate. Placement unchanged (mirrors the sandbox port).
  **GATE-APPROVAL PASSED.**

### [PRE-IMPLEMENT REFRESH] — 2026-07-19

Picked up for implementation (owner: continue the roadmap). Re-verified grounding: the `agent-tools/src/sandbox`
precedent exists to mirror; `computer-use` is not yet implemented. **Scope of THIS slice = P1** (neutral
`IComputerDriver` port + perceive/action-contract types + `ComputerView`/`Computer` tool factory + `ScriptedComputerDriver`

- two-tool permission wiring + assembly threading + adapter-gating). TC-01..08 are unit/functional against the
  `ScriptedComputerDriver` — no real browser needed. **Capability-reachability / agent-run note** (per the 2026-07-18 rule):
  P1 is a **library seam** (port + tool + `/testing`-only scripted driver, adapter-gated OFF) — user-facing computer-use only becomes
  reachable when a concrete driver is injected, so P1 does NOT claim the capability user-done. The **agent-run
  browser verification is named as the pending P2 deliverable** (the zero-dep `PageComputerDriver` driven against a real
  rendered page under `xvfb-run`, which is available) — that slice will carry the agent-run e2e evidence. Proceeding to
  GATE-IMPLEMENT for P1.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-19

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL shows PASS (`GATE-APPROVAL PASSED`, iteration 2 ENDORSE, 2026-07-17); frontmatter `status: approved` in `todo/` matches the expected GATE-IMPLEMENT input stage; `[PRE-IMPLEMENT REFRESH] — 2026-07-19` entry present (grounding re-verified, scope = P1, agent-run browser verification named as pending P2). ✅
- Tasks file created: `.agents/tasks/SELFHOST-010-P1.md` exists on disk (3383 bytes). ✅
- Tasks file path recorded in the spec's `## Tasks` section (links to `../../tasks/SELFHOST-010-P1.md`). ✅
- Tasks map to Completion Criteria: P1 slices S1–S6 explicitly annotated with TC targets — S2→TC-01, S3→TC-02/07/08, S4→TC-03, S5→TC-04, S6→TC-05/06 — covering TC-01..TC-08. ✅
- Test Plan present in task file: `## Test Plan` section (~640 chars, well over 50) enumerating TC-01..TC-08 unit/functional coverage against `ScriptedComputerDriver` plus regression commands; agent-run browser verification explicitly DEFERRED to P2. ✅
- No implementation commits yet: `packages/agent-tools/src/computer-use/` does not exist on disk. ✅

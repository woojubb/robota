# ARCH-005 S3 — a third party builds a product on the published packages (agent-run)

**Spec:** ARCH-005 (external product composition — `assembleProduct` + `ICapabilityPack` + `IProductProfile`).
Proves Modes **A**, **B** and **C** from **genuinely outside the monorepo**: a throwaway consumer package
installs `pnpm pack` tarballs with `npm install`, type-checks against the SHIPPED `.d.ts` files, and asserts
real composition behaviour — not merely that the imports resolve.
**Type:** agent-executable (the agent packs, installs, compiles and runs the proof itself; no owner action).

The done-gate question ARCH-005 exists to answer is not "do the packages build" but "can somebody who is not
us ship a product on them". Everything below therefore runs against `node_modules`, never against workspace
sources: no `workspace:` link, no path alias, no relative import into the repo. `npm overrides` pin every
`@robota-sdk/*` specifier to a local tarball, because `@robota-sdk/agent-core@3.0.0-beta.79` IS published —
without the pin, npm would silently install the REGISTRY build for the transitive deps and the proof would be
measuring the wrong tree.

## Scenario

```bash
pnpm build            # the tarballs are packed from dist/, so the build must be current
pnpm proof:external   # node scripts/external-proof/run-external-proof.mjs
```

The runner: derives the workspace dependency closure of the entry packages (17 packages), refuses to run if
any lacks build output, `pnpm pack`s each, materialises the consumer fixture into a temp dir **outside the
repo** (it hard-fails if the working directory is inside it), `npm install`s the tarballs, runs
`tsc` with `skipLibCheck: false` against the published types, and executes the Mode A/B/C assertions.

- **Mode A** — a profile with only `providerDefinitions` + branding, then `providerSettings`, then
  `pack-coding`. Asserts the consumer's own identity is surfaced, that the **provider is constructed
  IN-KERNEL** from the definitions (the consumer builds none and depends on no `agent-provider-*` package),
  that an unknown provider name is rejected by the kernel, and that `buildRuntime` returns a live framework
  `InteractiveSession`.
- **Mode B** — a hand-written `IPreset`. Asserts the resolved options carry its persona/model/effort/denied
  tools, that the permission posture is DERIVED from the `autonomy` dial, that the posture reaches the session
  options (and does not overwrite an explicit shell value), and the **R8 per-call registry** property: the
  preset does not leak into a second `assembleProduct` call, nor into `agent-preset`'s module-level global.
- **Mode C** — Robota's `careful-reviewer` preset by id + a consumer-authored `ICapabilityPack` (own tool,
  command module and subagent). Asserts the additive merge order (`base ⊕ packs in profile order`), that a
  deliberate id collision is **reported on the rejection channel** with distinct base-vs-pack reasons and
  first-registration-wins, that the tool axis reaches the runtime through `buildRuntimeOptions`, and — section
  C5 — measures the tool axis's honest limitation from the published surface.

## Observed (2026-07-25)

```
[1/5] pnpm pack — 17 published packages (workspace dependency closure)
[2/5] materialising the external consumer package
[3/5] npm install (real tarball install — no workspace link, no relative import)
      added 124 packages in 1s
[4/5] tsc — type-check the consumer against the SHIPPED .d.ts surface
[5/5] running the Mode A/B/C assertions
...
  C5 — the tool axis's limitation, VERIFIED from the published surface (not just asserted)
    ok  a pack tool the framework does NOT ship is genuinely additive — it reaches the runtime
    ok  but pack-coding's tools are name-identical to the framework default set
    ok  and the overlay only APPENDS to additionalTools — it cannot suppress the framework defaults

------------------------------------------------------------------------
EXTERNAL PROOF PASSED — 65 assertions across Modes A, B and C.
```

Exit code 0. `tsc` produced no diagnostics with `skipLibCheck: false`, so the published `.d.ts` surface is
self-consistent and sufficient for all three modes.

### Proven NOT accidentally green

Two mutations were planted in the shipped source, the two packages rebuilt, and the proof re-run:

| Mutation                                                              | Result                         |
| --------------------------------------------------------------------- | ------------------------------ |
| `mergeCapabilityPacks` drops the rejection channel and silently skips | 6 assertions FAIL              |
| `assembleProduct`'s overlay drops the `agentDefinitions` injection    | 1 assertion FAILS              |
| Combined                                                              | `FAILED — 7 failed, 58 passed` |

Both mutations were then reverted and the packages rebuilt; the proof returns to 65/65. **No product source
was changed to make the proof pass** — S3 needed none.

## Published-surface findings (recorded, not worked around silently)

Documented in `scripts/external-proof/fixture/src/surface-notes.ts`. None blocks any mode.

- **F1** — `buildRuntimeOptions` returns the UNION `TInteractiveSessionOptions`, so a consumer must narrow it
  before reading back `additionalTools` / `agentDefinitions` — the very fields the overlay just added. The
  return type does not track the branch of the input that produced it.
- **F2** — `IAssembledProduct.provider` is optional while `IInteractiveSessionStandardOptions.provider` is
  required, so a consumer relying on in-kernel construction still asserts non-null at the call site.
- **F3** — `ICommandResult` is not re-exported from `@robota-sdk/agent-framework`. Authoring a command module
  works (the return literal is contextually typed by `ISystemCommand`), but naming the return type requires
  reaching into `@robota-sdk/agent-interface-transport`.

## Honest scope of the Mode C claim

The pack **command-module** and **subagent** axes are fully additive. The **tool** axis is additive for tools
the framework does not already ship, through `buildRuntime`/`buildRuntimeOptions` only:
`createSession` assembles `[...createDefaultTools(), ...additionalTools]` with no dedupe and no suppression
hook, so a pack cannot remove or replace a framework default, and a pack whose tools duplicate the defaults
(as `pack-coding`'s do, by design) would be listed twice. Closing that is **ARCH-006**; nothing stronger is
claimed here.

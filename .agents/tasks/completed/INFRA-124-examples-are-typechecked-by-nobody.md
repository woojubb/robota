---
title: 'INFRA-124: packages/*/examples was read by no typechecker, so a breaking signature change landed green'
status: done
completed: 2026-08-21
created: 2026-08-20
priority: high
urgency: now
area: packages
depends_on: []
---

# INFRA-124: the compiler reads the directory CI executes

## Objective

Issue #1902. `packages/*/examples/` was typechecked by nobody. Nine packages carry such a directory,
and several hold executable scenario verifiers wired into `scenario:verify`, which `quality` runs as a
required check. So CI EXECUTED that code while the compiler never read it — the worst of both: it can
break the gate, and the gate that would have caught it at compile time did not look.

## The measurement the issue asked for, taken properly

Issue #1902 said the blast radius had to be measured against a full declaration build before the shape
could be chosen, and recorded that my first probe was untrustworthy — it was dominated by `TS7016`
because an ad-hoc config did not reproduce the workspace's `exports`/type resolution.

Taken again after `pnpm build`, with each package's own `tsconfig.json` extended rather than replaced:

| package                                                                                                  | errors |
| -------------------------------------------------------------------------------------------------------- | ------ |
| agent-command                                                                                            | 2      |
| agent-core                                                                                               | 3      |
| agent-session                                                                                            | 8      |
| agent-executor, agent-framework, agent-product, agent-transport, agent-transport-tui, agent-transport-ws | 0 each |

**Thirteen, not hundreds.** The earlier estimate was wrong by orders of magnitude, and wrong in the
direction that would have justified deferring this.

Two of the thirteen were configuration rather than code: `agent-core` genuinely imports `../src/*.ts`
by extension because `tsx` runs its source directly, so that package's config enables
`allowImportingTsExtensions` rather than the examples being rewritten to lie about how they run.

## What the other eleven were

Every one a real defect a reader would have wanted to know about:

- **`TDirectSession` read `.session` off a `Promise`.** ARCH-035 made `createSession` async; INFRA-119
  awaited the CALL and left this alias one line over, resolving to `never` in silence. The same
  defect, in the same file, surviving the fix for it — because nothing typechecked the directory.
- **A command descriptor omitted `userInvocable`**, which `ICapabilityDescriptor` requires.
- **Five message literals omitted `id` and `state`**, which `IBaseMessage` requires.
- **Three terminal stubs omitted `writeError`, `prompt` and `select`**, which `ITerminalOutput`
  requires. The `select` signature was read from the contract rather than guessed — my first stub had
  a plausible generic shape the interface does not use.

## Approach

Each package gains a `tsconfig.examples.json` extending its own config, and its `typecheck` script
runs it. Wiring into the EXISTING gate rather than adding a new one: `quality` already runs
`typecheck` per affected package, so no workflow changes and no second thing to remember.

`rootDir` is the reason a separate config is needed at all — the package config sets it to `src` with
`declaration: true`, and widening `include` to `examples` conflicts with both.

## Plan

- [x] TC-01: measured all nine packages against a real declaration build — 13 errors, not the
      untrustworthy earlier figure.
- [x] TC-02: every error fixed, or its configuration cause named (`allowImportingTsExtensions`).
- [x] TC-03: all nine packages typecheck their examples at zero.
- [x] TC-04: `scenario:verify` still passes — the edits are type-level, and the behaviour is unchanged.
- [x] TC-05: reintroducing the INFRA-119 defect is caught at TYPECHECK time, not scenario runtime —
      the issue's definition of done, verified by actually reintroducing it. Dropping the `Awaited<>`
      from `packages/agent-command/examples/semantic-command-role-scenario-helpers.ts:19` makes that
      package's `pnpm typecheck` report
      `semantic-command-role-scenario-helpers.ts(19,63): error TS2339: Property 'session' does not
  exist on type 'Promise<ICreateSessionResult>'`; restoring it returns the run to exit 0. Re-run
      on 2026-08-21 at close, not carried over as a claim.
- [x] TC-06: `pnpm harness:pre-push` green.

## Test Plan

The compiler is the test. What needs proving is that it now READS this directory, which a passing
typecheck cannot show on its own — a config that included nothing would also pass.

So the proof is the red-proof: dropping the `Awaited<>` from the `TDirectSession` alias in
`packages/agent-command/examples/semantic-command-role-scenario-helpers.ts:19` produces
`error TS2339: Property 'session' does not exist on type 'Promise<ICreateSessionResult>'` from
`pnpm typecheck`, where before this change it produced nothing until the scenario ran and threw two
frames away.

The mutated token is the `Awaited<>` in the ALIAS, not the `await` on the call INFRA-119 fixed —
those are one line apart, and naming the wrong one is what let the alias resolve to `never` in
silence in the first place.

## Progress

### 2026-08-20

Filed as issue #1902 from INFRA-119, where the gap let a sync-to-async signature change land green.
The count came in an order of magnitude under the earlier estimate, which is worth recording: the
first probe's noise was an artefact of how it was taken, and had it been believed this would have been
deferred as a nine-package migration rather than done as a thirteen-error fix.

### 2026-08-21

TC-06 executed rather than assumed. The implementation is `18dbba14a` (pull request #1936) on `develop`.

`pnpm harness:test` — 221 files / 4087 tests and 73 files / 1113 tests, all passed, exit 0.
`pnpm harness:scan` — 129 scans, 0 failures.

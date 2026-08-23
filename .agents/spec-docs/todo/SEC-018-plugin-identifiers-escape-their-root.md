---
status: approved
type: SECURITY
tags: [security]
---

# SEC-018: plugin identifiers and registry paths escape the plugin root

Paired with `.agents/tasks/SEC-018-plugin-identifiers-escape-their-root.md`.
Converted from [issue #2020](https://github.com/woojubb/robota/issues/2020).

## Problem

See the paired Task for the four value→sink pairs. In short: remote manifests and the on-disk registry
were cast after two shallow checks, and their strings then became path components or paths reaching
`renameSync`, `cpSync` and a recursive `rmSync`.

## Prior Art Research

Waived: the design question is which of this repository's own boundaries owns validation of its own
persisted structures, and the repository has already answered it once for the same class of value.
`packages/agent-session/src/session-id.ts` (SEC-006) guards session ids used as path components, and
states both load-bearing decisions — the guard at the boundary rather than at each `join()`, and
reject rather than sanitize, because sanitizing aliases two distinct identifiers onto one file. This
applies that decision to plugin identifiers, and extends it with containment because these values can
also be paths rather than only components. Recorded rather than left empty, per
[research.md](../../rules/research.md).

## Architecture Review

**Alternatives.**

1. **Sanitize the identifier** (strip traversal, replace separators). Rejected on SEC-006's recorded
   reason, restated for this surface: stripping `../` from `../x` yields `x`, a name another plugin may
   legitimately hold, so the hostile and benign identifiers map to one directory. A silent
   cross-linking is worse than a loud refusal.
2. **Check containment at each sink.** Rejected: one name reaches four sinks (rename, copy, load,
   recursive delete). A per-sink check is four opportunities to miss one, and the miss is silent.
3. **Lexical containment** (`resolve` + `startsWith`). Rejected because it cannot see a symlink:
   `<root>/link` → `/etc` passes it. That is the acceptance criterion "symlinks inside plugin roots
   cannot redirect copy, load, rename or deletion outside the root", and lexical checking fails it by
   construction rather than by oversight.
4. **Boundary guard + canonical containment.** Chosen.

**Port change.** `IFileSystem` gained `realpathSync`. Additive; the interface has exactly one
implementer (`NodeFileSystem`) and zero object-literal doubles in the workspace, verified before
choosing this over threading a separate canonicaliser through four constructors.

**Ordering.** Validation happens where the value is read, not where it is used, so a malformed manifest
is refused before any filesystem mutation is attempted. The acceptance criterion "failed validation
performs no filesystem mutation" cannot be satisfied by a check sitting next to the `renameSync`.

**Responsibility split.** `marketplace-client.ts` crossed the 300-line cap. Split by responsibility
rather than baselined: the client MANAGES marketplaces, `marketplace-manifest.ts` decides whether a
fetched file is a manifest at all. Keeping them together is what let a manifest be
`data as IMarketplaceManifest` after two shallow checks.

## Completion Criteria

- **TC-01** Every identifier used as a path component is validated at the boundary it enters.
- **TC-02** Dot segments, both separators, absolute paths, drive/UNC, NUL and percent-encoded traversal
  are rejected.
- **TC-03** Containment is judged on canonical paths, so a symlink cannot redirect a mutation.
- **TC-04** A destination that does not exist yet is checked before it is created.
- **TC-05** A tampered registry `installPath` cannot delete outside the plugin root, and its entry is
  still removed so one bad record cannot pin itself in place.
- **TC-06** Failed validation performs no filesystem mutation.
- **TC-07** Three mutants die; the suite is green restored.

## Test Plan

See the paired Task. TC-07 is load-bearing: a containment check that cannot go red on a symlink is the
accidental-green shape issue #2181 catalogues, and mutant B is exactly that case.

## Evidence Log

| Claim                                                    | Verified at                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                                            | Standing owner instruction, current conversation: decide by the repository's rules, escalate only what they cannot settle. A filed P1 security issue with stated acceptance criteria and an in-repo precedent (SEC-006) for the design. No product-direction, published-contract-removal or novel-practice decision is involved; the one port change is additive. Inside the delegated class. |
| The manifest name selected a rename destination          | `marketplace-client.ts` — `join(this.marketplacesDir, name)` then `renameSync`, pre-change                                                                                                                                                                                                                                                                                                    |
| The registry `installPath` drove a recursive delete      | `marketplace-registry.ts` — `fs.rmSync(record.installPath, { recursive: true, force: true })`, pre-change                                                                                                                                                                                                                                                                                     |
| `IFileSystem` had one implementer and no literal doubles | `NodeFileSystem`; `grep 'as IFileSystem\|: IFileSystem = {'` → 0                                                                                                                                                                                                                                                                                                                              |
| A symlink defeats lexical containment                    | mutant B: canonical replaced by `resolve` → 2 tests red                                                                                                                                                                                                                                                                                                                                       |
| The separator makes prefix comparison a containment test | mutant C: separator removed → the `/a/plugins-evil` case red                                                                                                                                                                                                                                                                                                                                  |
| Mutants die                                              | segment guard neutered → 19 red; lexical → 2 red; no separator → 1 red; restored → 29 green                                                                                                                                                                                                                                                                                                   |
| Suites pass                                              | `agent-framework` 1494, `agent-command` 292, `harness:scan` 141 passed / 0 failed                                                                                                                                                                                                                                                                                                             |

## User Execution Test Scenarios

**Not applicable.** Executing one means installing a marketplace whose manifest is named
`../../escaped-market`. On the fixed build it is refused; demonstrating it WAS exploitable requires
running the vulnerable code, and a scenario whose negative case writes outside the user's plugin root
is not one to hand a user. The property is asserted at the boundary instead, where the hostile value
is observable with no filesystem mutation attempted. `.agents/tasks/README.md` requires the
not-applicable to carry its reason; this is it.

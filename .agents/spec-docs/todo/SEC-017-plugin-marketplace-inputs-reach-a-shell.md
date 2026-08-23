---
status: approved
type: SECURITY
tags: [security]
---

# SEC-017: plugin marketplace inputs are interpolated into shell command strings

Paired with `.agents/tasks/SEC-017-plugin-marketplace-inputs-reach-a-shell.md`.
Converted from [issue #2019](https://github.com/woojubb/robota/issues/2019).

## Problem

See the paired Task for the four interpolation sites. In short: the plugin execution port was a single
command string, the production adapter passed it to `execSync`, and `execSync` always runs its argument
through a shell — so any marketplace URL, plugin repository URL or persisted install path containing
shell syntax executed additional host commands as the user running agent-cli.

## Prior Art Research

Waived: an external survey would be weaker than the in-repo precedent this design already follows.
`apps/action/src/build-invocation.ts` (SEC-006) already replaced `execSync(args.join(' '))` with a
file-plus-vector for exactly this reason, and states the principle — _"there is no quoting to get
right, because no shell ever parses these values"_. The design here is that decision applied to a
second surface rather than a new one. The waiver is recorded rather than the section left empty, per
[research.md](../../rules/research.md).

## Architecture Review

**Alternatives.**

1. **Quote the interpolated values.** Rejected, and the issue instructs it directly: _"Do not treat
   quoting helpers as the primary boundary: remove shell parsing from this workflow."_ A quoting helper
   is a second parser that must agree with the shell's parser forever, across platforms and shells. A
   vector removes the second parser rather than trying to match it.
2. **Validate the URLs and reject metacharacters.** Rejected as the primary boundary for the same
   reason — it is a denylist over syntax, and it leaves the shell in the path so that anything the
   validator misses is still executed. Validation remains useful, but not as the thing standing between
   an attacker and the host.
3. **Argument vector, shell removed.** Chosen.

**The second door.** Argv stops the shell; it does not stop git. `GIT_SSH_COMMAND`,
`GIT_EXTERNAL_DIFF`, `GIT_PROXY_COMMAND` and `GIT_ASKPASS` each name a program git executes, so an
inherited one reaches the same arbitrary execution with no shell involved. The subprocess environment
is therefore reduced to an explicit allowlist — an allowlist and not a denylist, because the set of
git-honoured variables is git's to grow and a denylist written today is wrong the next time it does.

**The third door.** `--` precedes the operands at both clone sites. Argv does not stop git reading an
operand that begins with `-` as an option, and `--upload-pack=…` names a program git runs.

**Capability preservation.** Every call site performs the same git operation with the same timeout and
stdio. The only behaviour that changes is that values are no longer parsed as syntax.

**Blast radius.** The port, its two consumers, and the one production adapter. `execSync` elsewhere in
the workspace (`dag-cli/src/commands/mcp.ts`, `agent-transport` headless, `agent-cli/src/startup/
shell-exec.ts`) is out of this issue's scope and is untouched.

## Completion Criteria

- **TC-01** `TExecFn` takes `(file, args: readonly string[], options)`.
- **TC-02** All four call sites pass vectors; no template literal builds a git command.
- **TC-03** The adapter uses `execFileSync` with `shell: false` stated explicitly.
- **TC-04** Git subprocesses inherit only an allowlisted environment.
- **TC-05** Both clone sites pass `--` before their operands.
- **TC-06** Tests assert executable and argv separately, never a joined command string.
- **TC-07** Hostile input arrives as exactly one argv element, byte for byte.
- **TC-08** Three mutants die: argv folded to a shell string, `--` removed, environment passthrough.

## Test Plan

See the paired Task. TC-08 is the load-bearing one: without a killed mutant, a security fix's green is
the accidental-green shape issue #2181 catalogues — and a test that asserts
`stringContaining('git clone')` passes just as well against the vulnerable code.

## Evidence Log

| Claim                                             | Verified at                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                                     | Standing owner instruction, current conversation: decide by the repository's rules and escalate only what they cannot settle. This is a filed P1 security issue with stated acceptance criteria and an in-repo precedent (SEC-006) for the chosen design; nothing in it is a product-direction, published-contract or novel-practice decision. Inside the delegated class. |
| The port was a command string reaching `execSync` | `marketplace-types.ts` pre-change; `default-plugin-command-adapter.ts:35` and `:111`                                                                                                                                                                                                                                                                                       |
| Four interpolation sites                          | `marketplace-client.ts:79/174/228`, `bundle-plugin-installer.ts:237`                                                                                                                                                                                                                                                                                                       |
| The repository had already made this fix once     | `apps/action/src/build-invocation.ts`, SEC-006                                                                                                                                                                                                                                                                                                                             |
| Hostile input arrives as one inert argument       | 8 shell constructs, each asserted byte-for-byte as a single argv element with no fragment split off                                                                                                                                                                                                                                                                        |
| The environment is allowlisted                    | 12 executable-naming `GIT_*` variables dropped; an unknown variable dropped                                                                                                                                                                                                                                                                                                |
| Mutants die                                       | argv → shell string: 9 red; `--` removed: 1 red; env passthrough: 14 red; restored: 24 green                                                                                                                                                                                                                                                                               |
| Existing suites unaffected                        | `agent-framework` 1456 tests pass; `agent-command` typecheck clean                                                                                                                                                                                                                                                                                                         |

## User Execution Test Scenarios

**Not applicable, and the reason is the finding.** Executing it means running `agent-cli` with a
marketplace URL containing shell metacharacters. On the fixed build that is inert — but demonstrating
that it WAS exploitable requires running the vulnerable code, and a scenario whose negative case
executes an attacker's command on the user's machine is not one to hand a user. The property is
asserted at the port instead, where the hostile value is observable without any process being spawned.
`.agents/tasks/README.md` requires the not-applicable to carry its reason; this is it.

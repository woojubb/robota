---
title: 'SEC-017: plugin marketplace inputs are interpolated into shell command strings'
issue: https://github.com/woojubb/robota/issues/2019
status: done
completed: 2026-08-23
created: 2026-08-23
priority: critical
urgency: now
area: packages/agent-framework/src/plugins, packages/agent-command/src/plugins
depends_on: []
---

# SEC-017: plugin marketplace inputs are interpolated into shell command strings

## Problem

The plugin execution port was a single command STRING:

```ts
export type TExecFn = (command: string, options: {...}) => string | Buffer;
```

and the production adapter passed that string to `execSync`, which always runs its argument through a
shell. Four sites interpolated attacker-reachable values into it:

| site                             | interpolated                                  |
| -------------------------------- | --------------------------------------------- |
| `marketplace-client.ts:79`       | `git clone --depth 1 ${cloneUrl} ${tempDir}`  |
| `marketplace-client.ts:174`      | `git -C ${entry.installLocation} pull`        |
| `marketplace-client.ts:228`      | `git -C ${dir} rev-parse HEAD`                |
| `bundle-plugin-installer.ts:237` | `git clone --depth 1 ${repoUrl} ${targetDir}` |

A marketplace URL, plugin repository URL, marketplace name or persisted install path containing `;`,
`&&`, `$(…)`, a backtick or a newline therefore executed additional host commands as the user running
agent-cli — reachable through a copied command, a shared configuration, or compromised plugin metadata.

## Decision

Replace the port with an argument vector and remove the shell from this workflow entirely.

```ts
export type TExecFn = (
  file: string,
  args: readonly string[],
  options: { timeout: number; stdio?: string },
) => string | Buffer;
```

The adapter uses `execFileSync` with `shell: false` passed explicitly rather than left to the default —
the default is what a later edit changes without noticing, and it is the one line the whole fix rests
on.

**The repository had already reached this conclusion once.** `apps/action/src/build-invocation.ts`
(SEC-006) replaced `execSync(args.join(' '))` for the same reason and states it plainly: _"Returning a
vector (rather than a string) is what makes the invocation safe by construction: there is no quoting to
get right, because no shell ever parses these values."_ This applies that fix to the plugin surface.

**Quoting helpers were considered and rejected**, per the issue's own instruction not to treat them as
the primary boundary. A quoting helper is a parser that must agree with the shell's parser forever; a
vector removes the second parser.

## Two doors, not one

Argv stops the SHELL. It does not stop GIT. `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`,
`GIT_PROXY_COMMAND` and `GIT_ASKPASS` each name a PROGRAM git executes, so an inherited one turns
`git clone <url>` into "run whatever that variable says" — the same arbitrary execution, reached
without any shell at all. So the subprocess environment is reduced to an explicit allowlist.

An allowlist rather than a denylist because the set of git-honoured variables is git's to grow, and a
denylist written today is wrong the next time it does.

`--` precedes the operands at both clone sites: argv alone does not stop git reading
`--upload-pack=…` as a flag it should honour.

## Plan

- [x] Port becomes `(file, args, options)` with `readonly string[]`.
- [x] All four call sites pass vectors.
- [x] Adapter uses `execFileSync` with `shell: false` and a scrubbed environment.
- [x] Existing tests migrated from command-string parsing to file+argv assertions.
- [x] Injection-property and environment tests.

## Test Plan

- `sec-017-argv-injection.test.ts` — eight real shell constructs (`;`, `&&`, `$(…)`, backticks,
  newline, embedded quotes, spaces, `|`) each asserted to arrive as **exactly one** argv element,
  byte for byte, with no fragment split off it and no marker command becoming an argument. Plus the
  `--` separator case for an option-like URL.
- `sec-017-git-env-scrub.test.ts` — twelve executable-naming `GIT_*` variables dropped; `PATH`/`HOME`
  and proxy variables kept; an unknown variable dropped, which asserts the direction of the default
  rather than a list of known-bad names.
- **Three mutants killed, proven rather than asserted:** argv folded back into one shell string (the
  original defect) → **9 red**; `--` separator removed → **1 red**; environment scrub made a
  passthrough → **14 red**; restored → **24 green**.
- Existing suites: `agent-framework` 1456 tests, `agent-command` typecheck clean.

## User Execution Test Scenarios

**Not applicable as a product scenario, and the reason is the finding itself.** Executing the scenario
means running `agent-cli` with a marketplace URL containing shell metacharacters — on the fixed build
it is inert, but the check that it WAS exploitable requires running the vulnerable code, and a scenario
whose negative case executes an attacker's command on the user's machine is not one to hand a user.
The property is asserted instead at the port, where the hostile value can be observed without any
process being spawned: the tests above capture what would have been passed and assert it is one inert
argument. `.agents/tasks/README.md` requires the not-applicable to carry its reason; this is the reason.

## Delivery

Delivered by PR #2207, merged into `develop`. The record stayed `in-progress` after that
merge, which is issue #2186 — a task record can stay open after its deliverable lands and nothing
says so. Closed here rather than left as evidence of the gap.

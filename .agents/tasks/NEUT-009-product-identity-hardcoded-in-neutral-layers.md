---
title: 'NEUT-009: product identity (`.robota`, `.claude`, `AGENTS.md`, `robota-cli`, `/provider`) is hardcoded across four neutral library layers, and no neutrality scan covers the layers where it happens'
status: in-progress
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-preset, packages/agent-command, packages/agent-session, packages/agent-cli, scripts/harness
depends_on: []
---

# NEUT-009: there is no injected product-identity/paths port, so every library writes the product's name

## Problem

Four layers — the widest blast radius of any single invariant in the audit. A second product built on
these libraries inherits `robota`'s directory names, its config file names, its default agent name,
and model-facing text that tells the user to run `/provider`. Mostly this is loud on adoption, but one
instance is an **outright bug**: the command whose entire job is reporting which configuration is in
effect reports the wrong file.

The guard gap is verifiable: the neutrality scan is scoped to two packages that were already clean,
and covers **neither** of the two library packages where the un-fixable instances live.

## Evidence

Observed by **L1, L2, L3 and L4**.

- L2 F5 — `agent-framework/src/paths.ts:20,37`; `interactive/interactive-session-init.ts:105`;
  `assembly/create-session.ts:190-197` (allowlist literals `Read(.agents/**)`, `Read(.claude/**)`,
  `Read(.robota/**)`) and `:218`; `commands/skill-source.ts:157-161`;
  `plugins/marketplace-client.ts:87,201`; `utils/error-humanizer.ts:12,55` (model-facing text
  _"Run `/provider` … (`~/.robota/settings.json`)"_); `context/context-loader.ts:35-36`;
  `agent-preset/src/resolve-preset.ts:31` (`DEFAULT_AGENT_NAME = 'robota-cli'`);
  `load-external-presets.ts:18`. **The guard gap is verifiable:**
  `.agents/harness.config.json` `productShellDirs` is `["packages/agent-cli","apps/agent-web","apps/docs","apps/blog"]`
  and `scripts/harness/scan-composition-neutrality.mjs:9-22` covers only `agent-product` and
  `agent-capability-pack` — neither `agent-framework` nor `agent-preset` is covered by any neutrality
  scan.
- L4 L8 — the product rebuilds the same literal at
  `agent-cli/src/startup/diagnose-command.ts:132-133`, `startup/memory-enablement.ts:141`,
  `remote-control/host-identity.ts:41`, `remote-control/trusted-device-store.ts:46`. The diagnose site
  is an outright bug: `join(process.env['HOME'] ?? '', '.robota', 'settings.json')` — on Windows
  `HOME` is normally unset, so this becomes a **relative** path resolved against cwd, and the command
  whose entire job is reporting which configuration is in effect reports the wrong file. L4 also
  enumerates ten further `'.robota'` literals inside `agent-framework` itself
  (`agents/agent-definition-loader.ts:163,166`, `memory/project-memory-store.ts:66`,
  `memory/pending-memory-store.ts:20`, `update-check/update-check.ts:70`, `config/config-loader.ts:227`,
  plus L2's).
- L3 L9 — `agent-command/src/plugins/default-plugin-command-adapter.ts:1-2,30-33`: `execSync` plus
  `join(home,'.robota','plugins')` and `join(home,'.robota','settings.json')` baked into a library.
- L1 18h — `agent-session/src/session-store.ts:64`: library default path `~/.robota/sessions`.

The cause in one sentence, from the synthesis: _there is no injected product-identity/paths port, so
every library that needs the config root writes the product's name — and the neutrality scan was
scoped to the two packages that were already clean._

## Why this is foundational (or not)

**The synthesis records a depth disagreement and resolves it as "both are right, describing different
sites" (correction 3):**

- L2 F5 calls it **FOUNDATIONAL**; L3 L9 and L4 L8 call their instances **LOCAL**.
- L4's four `agent-cli` sites are locally replaceable with the existing
  `projectPaths()`/`getUserSettingsPath()` seam — and one of them is an outright bug.
- L2's `agent-framework`/`agent-preset` sites are **not fixable from above** — a second product
  inherits them — and, as L4 independently found, `paths.ts` is not even the exclusive owner _within
  its own package_ (ten further literals).

**Merged verdict: FOUNDATIONAL for the library sites, LOCAL for the shell sites.**

## Direction

The invariant the synthesis states for this class (theme T9): _knowledge flows toward the more stable
abstraction — a library must not name its consumer's product, vendor, or feature set._

The remediation the finding's own cause sentence names: an **injected product-identity/paths port**,
so a library that needs the config root receives it rather than writing the product's name. The
synthesis also names the seam that already exists on the shell side and is the model for the LOCAL
half: `projectPaths()` / `getUserSettingsPath()` — L4's four `agent-cli` sites are locally replaceable
with it.

Second, explicitly named as part of the same defect: **the scan must cover the layers where the
problem is.** `scan-composition-neutrality.mjs:9-22` covers only `agent-product` and
`agent-capability-pack`, and `.agents/harness.config.json` `productShellDirs` lists four product
directories — so neither `agent-framework` nor `agent-preset` is covered by any neutrality scan. The
synthesis files this under theme T11: _an enforcement mechanism must observe the surface the rule is
about; a green result is evidence only about what the check actually reads._

Risk named by the synthesis: `paths.ts` is **not the exclusive owner even within `agent-framework`**
(ten further `'.robota'` literals elsewhere in the package), so routing new callers through `paths.ts`
without sweeping those ten leaves the port bypassed on day one.

## Test Plan

- **Required red-first regression:** extend the neutrality scan to `agent-framework`, `agent-preset`,
  `agent-command` and `agent-session` (today `scan-composition-neutrality.mjs:9-22` covers only
  `agent-product` and `agent-capability-pack`). Against the current tree the extended scan must FAIL,
  listing the sites L2/L3/L4 enumerate. Observe it red before any literal is removed.
- **Required red-first unit regression for the diagnose bug:** run `diagnose` with `HOME` unset and
  assert the reported settings path is **absolute** and correct
  (`diagnose-command.ts:132-133`). Today it yields a relative path resolved against cwd.
- Assert `DEFAULT_AGENT_NAME` (`resolve-preset.ts:31`) is supplied by the host, not `'robota-cli'`
  baked into `agent-preset`.
- Assert model-facing text no longer names a product command/path from a library
  (`error-humanizer.ts:12,55`).
- Assert the library default session path (`session-store.ts:64`) comes from the injected port.
- Register the extended scan in `run-all-scans` and confirm local reachability.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies** — for the one instance that is user-visible behaviour: `diagnose` reporting which
configuration is in effect. (The neutrality port and the scan extension are internal and are covered
in `## Test Plan`; a second product built on the libraries is not a surface a user can run today.)

- **Prerequisites:** built `robota` CLI. The scenario needs an environment with `HOME` unset, which is
  the normal Windows case and is reproducible on any platform by unsetting the variable for one
  invocation. No fixture is required.
- **Steps:**
  1. With `HOME` unset, run the CLI's `diagnose` command from a directory that is **not** the user's
     home.
  2. Read the settings path it reports, and compare it against the file the CLI actually loads
     settings from in the same invocation.
- **Expected observable result (after the fix):** `diagnose` reports an **absolute** path, and it is
  the same file the CLI actually read.
- **Expected observable result (before the fix, for contrast):** it reports a **relative** path
  (`.robota/settings.json` resolved against the current directory) that is not the file in effect.
- **Cleanup:** none.
- **Evidence (fill in after implementation):** the `diagnose` output with `HOME` unset, alongside the
  path the session actually loaded.

## Implementation — stage 1 of 2

### The measurement gap, closed

The finding's central claim is that no scan covers the layers where the problem is, and that held
exactly: `scan-composition-neutrality` checks a different property (the assembler's purity, IO-freedom
and absence of product conditionals) over `agent-product` and `agent-capability-pack`, both already
clean. Nothing read `agent-framework`, `agent-preset`, `agent-command` or `agent-session`.

`scripts/harness/scan-product-identity.mjs` now does, as a ratchet: per-package occurrence counts of
the product's own names, frozen, may fall and never rise. Registered, and classified fail-closed by
execution (48 → 49 proven).

**The count is 108, not the 65 the finding implies.** The difference is not a disagreement — the audit
enumerated sites and this counts occurrences, including in comments.

Counting prose is deliberate and is the scan's most consequential decision. `paths.ts` opens with
"All CLI runtime data lives under .robota/": the documentation IS the coupling, not a remark about it,
and counting only string literals would make the docstring the cheapest place to keep it. The decision
demonstrated itself within minutes — the comment written to explain removing the product's name from a
temp-file marker quoted that name, and the count did not fall until the comment was reworded.

### Two things actually fixed

- **The outright bug.** `diagnose` built the user settings path from `process.env['HOME'] ?? ''`. On
  Windows `HOME` is normally unset, so the empty fallback made the path RELATIVE and it resolved
  against the working directory: the command whose entire job is reporting which configuration is in
  effect reported a different file, confidently. `homedir()` is the platform-correct answer and is
  what `agent-framework`'s `userPaths()` already used — `diagnose` was the one site that rebuilt it
  from the environment.

  Red-proved properly rather than conveniently: the first attempt failed with "function is not
  defined", which proves an export is missing and nothing about the defect. The expression was
  extracted verbatim first so the case could fail on the real thing — a relative path resolving under
  cwd — and only then fixed.

- **`agent-tools` reached zero.** Its one occurrence was `.robota-tmp-` in the temp filename every
  atomic write creates: a neutral tool library stamping the consumer's product name onto every file it
  wrote. Now `.atomic-tmp-`, which says what the file is. `agent-core` was already at zero. Both are
  frozen there, so a new product name in either fails immediately rather than joining a debt.

### Remaining — stage 2

The FOUNDATIONAL half is untouched: there is still **no injected product-identity/paths port**, and
the 108 occurrences are frozen, not removed. Specifically still true:

- `agent-framework/src/paths.ts` is not the exclusive owner even inside its own package — ten further
  `'.robota'` literals live elsewhere in it, so routing new callers through `paths.ts` without
  sweeping those leaves the port bypassed on day one. That risk is the finding's, and it stands.
- `DEFAULT_AGENT_NAME = 'robota-cli'` is still baked into `agent-preset`.
- `error-humanizer.ts` still tells a user to run `/provider` from a library.
- `agent-command`'s plugin adapter still joins `~/.robota/plugins` inside a library.
- The four `agent-cli` sites the audit calls LOCAL are still open; one of them was the bug fixed
  above, the other three are replaceable with the existing `projectPaths()` seam.

The ratchet is what makes that debt safe to carry: it cannot grow while the port is designed.

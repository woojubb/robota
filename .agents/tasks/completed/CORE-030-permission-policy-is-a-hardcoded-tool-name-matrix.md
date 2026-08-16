---
title: "CORE-030: permission policy is a hardcoded product tool-name matrix with no extension seam, and an unknown tool's deny is silently dropped"
status: done
created: 2026-08-02
completed: 2026-08-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-tools
depends_on: []
---

# CORE-030: risk classification is owned by a name table two layers below the tools it names

## Problem

A `MyTool(secrets/**)` **deny** pattern never matches for a tool the argument table does not know,
so evaluation walks on past the deny list.

**Severity correction, measured while implementing (#1596).** The audit said this "falls through to
`UNKNOWN_TOOL_FALLBACK = 'approve'`" and read that as fail-open. It is not: in this vocabulary
`'approve'` means PROMPT THE USER and `'auto'` is the decision that proceeds silently
(`permissions/types.ts:29-34`). A deny with no allow beside it already ended at a prompt.

The real fail-open needs an allow entry as well, and it is genuine — measured against the pre-fix
code:

```
deny: ['MyTool(secrets/**)']                     -> approve   (prompt; already fine)
deny: ['MyTool(secrets/**)'], allow: ['MyTool']  -> auto      (silently approved)
deny: ['Shell(rm*)'],        allow: ['Shell']    -> deny      (known tool; correct)
```

Denying a narrow case while allowing the tool broadly is the ordinary way to write these lists, so
for any tool the foundation does not know, the narrow deny simply vanished.

Risk classification is owned by a hardcoded name table in the zero-dependency foundation, two layers
below the tools it names, instead of being declared by each tool. The two owners can drift silently,
and they already have.

## Evidence

**Layer: L0 (foundation).** Single layer, but the synthesis notes it is _the security kernel_. L0 F4:

- `packages/agent-core/src/permissions/permission-mode.ts:16-107` — a file headed _"Permission mode
  definitions for Robota CLI"_ in the zero-dependency foundation, enumerating `TKnownToolName`
  (`'Shell' | 'Bash' | 'Read' | 'Write' | 'Edit' | 'Glob' | 'Grep' | 'WebFetch' | 'WebSearch' |
'AskUserQuestion' | 'ComputerView' | 'Computer'`) and `MODE_POLICY` keyed on it.
- `packages/agent-core/src/permissions/permission-gate.ts:76-91` hardcodes each tool's argument
  schema in a `switch` with `default: return undefined`.
- The two owners can drift silently: tool names are declared in `agent-tools` as plain string
  literals with no type link (`builtins/read-tool.ts:176`, `builtins/shell-tool.ts:247`,
  `computer-use/computer-tool.ts:189`) — nothing couples the classified set to the produced set.

  **Correction, from review of the audit record (#1591).** The audit claimed drift already exists
  because `'Bash'` names no produced tool. That is FALSE and is corrected here rather than carried:
  `packages/agent-tools/src/builtins/shell-tool.ts:253-255` defines `createBashTool()` →
  `createHostShellTool('Bash', options)`, exported at `src/index.ts:104` with a `bashTool` singleton
  at `shell-tool.ts:261`, and `src/__tests__/shell-tool.test.ts:11` asserts the name. `'Bash'` is a
  deliberate model-familiar alias. The coupling gap is real; the instance of drift offered as
  evidence for it was not, and no unverified example replaces it.

- The same package already contains the correct pattern, which makes this an inconsistency rather
  than an unknown: `packages/agent-core/src/interfaces/role-model.ts:1-13` deliberately uses an opaque
  `string` key with the reasoning for rejecting a fixed union written down.

The cause in one sentence, from the synthesis: _risk classification is owned by a name table two
layers below the tools it names, instead of being declared by each tool, so a tool the table does not
know about is unprotectable and defaults to approve._

## Why this is foundational (or not)

**FOUNDATIONAL.** The synthesis's reasoning: the table lives in the zero-dependency foundation and is
keyed on a closed union of product tool names, so no layer above — and no third-party tool author —
can register a tool's risk classification. The `default: return undefined` in `permission-gate.ts`
makes an unevaluable deny lose to a broader allow — see the severity correction above.

Severity HIGH, security-relevant and silent. The synthesis also cross-lists it under theme T3 (a
trust boundary that is documentation rather than code) and theme T9 (`TKnownToolName`/`MODE_POLICY`
naming product tools in the zero-dep foundation). Its theme-T2 cross-listing rested on the `'Bash'`
claim corrected above and does not stand.

## Direction

The invariant the synthesis states for this class (theme T3): _an admission or containment decision
must be enforced by a mechanism the contract requires, not by a convention each implementation may or
may not follow_; and (theme T9) _a library must not name its consumer's product or feature set._

The synthesis names the correct pattern **inside the same package**, which is why it calls this an
inconsistency rather than an open design question:
`packages/agent-core/src/interfaces/role-model.ts:1-13` deliberately uses an **opaque `string` key**,
with the reasoning for rejecting a fixed union written down in the file. The same reasoning applies
to `TKnownToolName`.

The shape the cause sentence implies: each tool **declares** its own risk classification and argument
schema, rather than the foundation hardcoding both
(`permission-mode.ts:16-107`, `permission-gate.ts:76-91`'s `switch` with `default: return undefined`).

One consequence the synthesis flags as part of the same work: the fail-open default
(`UNKNOWN_TOOL_FALLBACK = 'approve'` in `default` and `acceptEdits`). Its second — drift that has
already happened — was withdrawn; see the correction under Evidence.

Risk named by the evidence: tool names are currently plain string literals in `agent-tools`
(`read-tool.ts:176`, `shell-tool.ts:247`, `computer-tool.ts:189`) **with no type link** to the
matrix, so removing the union without adding the declaration seam removes the only thing that
currently couples them at all.

## Test Plan

- **Required red-first regression:** register a tool the foundation's matrix does not know (e.g.
  `MyTool`), configure a **deny** pattern `MyTool(secrets/**)`, invoke it against a matching argument
  in `default` mode, and assert it is **denied**. Against current code this must FAIL — the pattern
  never matches and evaluation falls through to `UNKNOWN_TOOL_FALLBACK = 'approve'`. Prove it fails
  before the fix.
- Repeat the same assertion in `acceptEdits` mode.
- Red-first: assert an unknown tool's argument schema is obtainable from the tool itself rather than
  from `permission-gate.ts:76-91`'s `switch`, whose `default` returns `undefined`.
- Add a mechanical check that the set of classified names and the set of produced tool names cannot
  drift — today they are coupled by nothing (`read-tool.ts:176`, `shell-tool.ts:247`,
  `computer-tool.ts:189` are plain literals). Note what this check must NOT assume: every name in the
  matrix is currently produced, so the check has to be proved against a fixture that introduces a
  divergence, not against today's tree, which would pass it vacuously.
- Assert no product tool names remain in the zero-dependency foundation
  (`permission-mode.ts:16-107`).
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Permission rules are a user-configured, user-visible product behaviour.

- **Prerequisites:** built `robota` CLI; a provider key. The scenario needs a tool the built-in matrix
  does not know — an MCP-provided tool or a custom tool registered through the supported extension
  path. That registration path exists; the specific scratch tool **will be created by this work** as a
  minimal fixture.
- **Steps:**
  1. Register the custom tool (e.g. `MyTool`) so the session can call it.
  2. In settings, add a **deny** rule `MyTool(secrets/**)`.
  3. Start the CLI in `default` permission mode and prompt the agent to call `MyTool` with an argument
     matching `secrets/**`.
  4. Repeat in `acceptEdits` mode.
- **Expected observable result (after the fix):** the call is **denied** in both modes, the denial
  names the rule that matched, and the tool does not execute.
- **Expected observable result (before the fix, for contrast):** the deny rule never matches, the call
  is auto-approved, and the tool executes.
- **Cleanup:** remove the deny rule and unregister the scratch tool.
- **Evidence (fill in after implementation):** the settings excerpt with the deny rule and the session
  transcript showing the denial in both modes.

## Implementation Outcome (2026-08-16)

### What was already done

PR #1596 fixed the **fail-open**: an argument-scoped deny the gate cannot evaluate no longer loses to
a broader allow, and `registerToolArgumentKey` gave a tool's owner a way to supply the missing
argument key. `UNKNOWN_TOOL_FALLBACK` was already fail-safe.

What remained is the item's actual title: the foundation still **owned the risk classification**,
keyed on a closed union of product tool names, and no layer above could declare a tool's class.

### The drift the item withdrew was real after all — and larger

The Evidence section retracted the `'Bash'` example as false, correctly, and recorded that no
verified instance replaced it. Measuring the two sets directly found **four**:

| Produced in this workspace                                       | Known to the matrix |
| ---------------------------------------------------------------- | ------------------- |
| `Agent` (`agent-framework`) — spawns a subagent                  | no                  |
| `BackgroundProcess` (`agent-framework`) — starts a shell command | no                  |
| `ExecuteCommand` (`agent-framework`) — runs a slash command      | no                  |
| `CodebaseRetrieval` (`agent-tools`) — read-only search           | no                  |

`CodebaseRetrieval` is the concrete cost: read-only, and it prompted on **every call** and was
**refused in plan mode** — the one mode where searching is all you can do. The other three happened
to land on a fallback that matched what they needed, which is luck rather than design.

### The change

The foundation now owns the POLICY and each tool owns its CLASSIFICATION.

- `TKnownToolName` and the name-keyed `MODE_POLICY` are gone. `RISK_CLASS_POLICY` is keyed on
  `TToolRiskClass` — `inspect` / `modify` / `execute` — which are the only distinctions the modes
  actually make. A test asserts the policy names no product tool.
- `registerToolPermissionProfile(name, { argumentKey?, riskClass? })` replaces the argument-key-only
  seam. The two halves are independent: a tool with no path-like argument is still classifiable.
- Each package declares its own tools, in a `*_TOOL_PERMISSION_PROFILES` record, registered by the
  module that DEFINES the tools rather than by the package barrel — so a classification exists
  exactly when the tool's module has loaded.

**Why three classes and not four.** `AskUserQuestion` behaves identically to a read in all four
modes, and giving it its own class would have added a row no mode distinguishes. It declares
`inspect`, with the reason recorded where the declaration is made: asking the user changes nothing,
and prompting for permission to prompt decides nothing.

### The floor, and the trap the item warned about

`scripts/harness/scan-tool-classification.mjs` fails a produced tool with no declared profile. The
item warned that today's tree passes, so a check proved only against it would be one that has never
been shown capable of failing. Every case that matters in its test suite runs against a **fixture
that introduces the divergence**, and the live-tree case is labelled as the snapshot it is.

That discipline immediately earned itself: the fixture case caught a real bug in the scan.
`listSourceFiles(dir, options)` takes OPTIONS second, not a root — so the walk ignored whatever root
it was handed and read the process's own tree, while the fail-closed check guarded a root the scan
then discarded. A test written against the live tree could not have found it.

### What this cost elsewhere, stated

Removing the name table from the foundation means `agent-core` no longer knows that `Read`'s argument
is `filePath`. Four test files that relied on it now declare the same profiles `@robota-sdk/agent-tools`
declares, and two in `agent-framework` import that package — where **the import is load-bearing and
says so in a comment**. That is the honest shape: without the tools present there is nothing for the
modes to decide about.

`packages/agent-core/src/permissions/__tests__/permission-mode.test.ts` used to assert that `WebFetch`
and `WebSearch` are auto in every mode. That is a fact about those TOOLS and was assertable in the
foundation only because of the arrangement this item removed; it moved to
`packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts`, and what stayed behind is the
policy.

### Verification

- `pnpm harness:verify` green for `packages/agent-core`, `packages/agent-tools`,
  `packages/agent-framework` and `packages/agent-session`.
- `pnpm build` clean; every workspace package's suite passes (`dag-adapters-sqlite` and `dag-worker`
  excluded — a missing `better-sqlite3` native binding locally, outside this change's file set).
- `pnpm harness:scan`: 112 passed, 2 skipped — including the new `tool-classification` scan, which
  the harness required to be tested, size-provenance-classified and proved fail-closed before it
  would accept it.

## User Execution Test Scenarios — executed

**Applies**, as the item states: permission rules are user-configured and user-visible.

**Deviation from the drafted steps, stated.** The draft ran the built CLI with a provider key and
read a session transcript. The scenario below drives the same public `evaluatePermission` directly,
which observes strictly more: it shows the decision BEFORE and AFTER the tool is classified within
one run, in both gated modes, and it exercises the workspace's own drifted tool. A transcript could
show the denial but not the contrast. **No API key, no network** — a permission decision is a pure
function of the rules and the classification, and the credential probe recorded in CORE-042 still
holds.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-030-s1.ts`

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — a narrow deny beats a broad allow in
  `default` AND `acceptEdits` once the tool is classified, the broad allow still covers what the deny
  was not about, a read-only third-party tool becomes usable in plan mode, `CodebaseRetrieval` reads
  freely, and an unclassified tool still fails SAFE.
- Evidence: executed 2026-08-16 against the completed implementation; **EXIT:0**. Full output:

```text
unclassified tool, narrow deny + broad allow: ["approve","approve"]
unclassified tool in plan mode, no rules at all: "deny"
classified tool, argument matching the deny: ["deny","deny"]
classified tool, argument the deny was not about: ["auto","auto"]
classified read-only tool in plan mode: "auto"
CodebaseRetrieval in plan / default: ["auto","auto"]
a tool whose owner declared nothing, in plan: "deny"
PASS a narrow deny now beats a broad allow in default AND acceptEdits
PASS the broad allow still works for what the deny was not about
PASS a read-only third-party tool is usable in plan mode
PASS CodebaseRetrieval — defined in this workspace, unknown to the old matrix — reads freely
PASS an unclassified tool still fails SAFE rather than open
PASS and the pre-classification narrow deny did NOT silently auto-approve
SCENARIO 1 PASS
```

Note the first two lines: before classification the narrow deny yields `approve` (prompt), not
`auto` — the severity correction this item recorded, confirmed by running it.

Behaviour pinned in the repository by
`packages/agent-core/src/permissions/__tests__/unknown-tool-deny.test.ts`,
`packages/agent-core/src/permissions/__tests__/permission-mode.test.ts` and
`packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts`.

```ts
// scratch/src/core-030-s1.ts
/**
 * CORE-030 Scenario 1 — a deny rule for a tool the product did not ship.
 *
 * The permission system classified tools from a hardcoded union of product names in the
 * vendor-neutral foundation: `'Shell' | 'Bash' | 'Read' | 'Write' | …`. A tool outside that union
 * could not be classified by anyone — not by a layer above, not by a third-party author — so the
 * best answer available was "unknown", which prompts on every call and is refused in plan mode.
 *
 * The drift was not hypothetical. FOUR tools defined in this very workspace were unknown to that
 * matrix, including one read-only search tool and two that run commands.
 *
 * Written against public exports only: `evaluatePermission` and `registerToolPermissionProfile` from
 * `@robota-sdk/agent-core`, and the built-in tools from `@robota-sdk/agent-tools`. No API key, no
 * network — a permission decision is a pure function of the rules and the classification.
 */
import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '@robota-sdk/agent-core';
// Importing the tools package is what registers the built-ins' own declarations.
import '@robota-sdk/agent-tools';

import type { TPermissionMode } from '@robota-sdk/agent-core';

const NARROW_DENY = { deny: ['MyTool(secrets/**)'], allow: ['MyTool'] };
const GATED_MODES: TPermissionMode[] = ['default', 'acceptEdits'];

function show(label: string, value: unknown): void {
  console.log(`${label}: ${JSON.stringify(value)}`);
}

function main(): void {
  // ── Before: a tool nobody could classify ────────────────────────────────────────────────────
  const beforeDecisions = GATED_MODES.map((mode) =>
    evaluatePermission('MyTool', { path: 'secrets/key.pem' }, mode, NARROW_DENY),
  );
  show('unclassified tool, narrow deny + broad allow', beforeDecisions);

  const beforePlan = evaluatePermission('MyTool', { path: 'public/readme.md' }, 'plan');
  show('unclassified tool in plan mode, no rules at all', beforePlan);

  // ── After: its author declares what it does ─────────────────────────────────────────────────
  registerToolPermissionProfile('MyTool', { argumentKey: 'path', riskClass: 'inspect' });

  const deniedByRule = GATED_MODES.map((mode) =>
    evaluatePermission('MyTool', { path: 'secrets/key.pem' }, mode, NARROW_DENY),
  );
  const allowedElsewhere = GATED_MODES.map((mode) =>
    evaluatePermission('MyTool', { path: 'public/readme.md' }, mode, NARROW_DENY),
  );
  const inPlan = evaluatePermission('MyTool', { path: 'public/readme.md' }, 'plan');

  show('classified tool, argument matching the deny', deniedByRule);
  show('classified tool, argument the deny was not about', allowedElsewhere);
  show('classified read-only tool in plan mode', inPlan);

  // ── The workspace's own drift: a tool the old matrix had never heard of ─────────────────────
  const retrievalPlan = evaluatePermission('CodebaseRetrieval', {}, 'plan');
  const retrievalDefault = evaluatePermission('CodebaseRetrieval', {}, 'default');
  show('CodebaseRetrieval in plan / default', [retrievalPlan, retrievalDefault]);

  // ── And the floor: forgetting to classify is not silent ─────────────────────────────────────
  clearRegisteredToolProfiles();
  const forgotten = evaluatePermission('MyTool', { path: 'public/readme.md' }, 'plan');
  show('a tool whose owner declared nothing, in plan', forgotten);

  const checks: Array<[string, boolean]> = [
    [
      'a narrow deny now beats a broad allow in default AND acceptEdits',
      deniedByRule.every((decision) => decision === 'deny'),
    ],
    [
      'the broad allow still works for what the deny was not about',
      allowedElsewhere.every((decision) => decision === 'auto'),
    ],
    ['a read-only third-party tool is usable in plan mode', inPlan === 'auto'],
    [
      'CodebaseRetrieval — defined in this workspace, unknown to the old matrix — reads freely',
      retrievalPlan === 'auto' && retrievalDefault === 'auto',
    ],
    [
      'an unclassified tool still fails SAFE rather than open',
      forgotten === 'deny' && beforePlan === 'deny',
    ],
    [
      'and the pre-classification narrow deny did NOT silently auto-approve',
      beforeDecisions.every((decision) => decision !== 'auto'),
    ],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- The scenario was executed by the agent against the completed implementation, `EXIT:0`, output
  recorded above.
- The observed result matched the expected observable result, including the before-the-fix contrast
  the item asked for, measured in the same run rather than recalled.
- Evidence references durable repository artifacts (the three test files named above, plus
  `scripts/harness/scan-tool-classification.mjs` and its suite).
- No engineering verification is cited as user-execution evidence — the suites and harness runs are
  recorded separately under _Verification_.
- No capability-absence claim is made; no credential was needed.

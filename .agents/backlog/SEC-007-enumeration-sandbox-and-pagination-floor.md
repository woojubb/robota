---
title: 'SEC-007: contain the tools that enumerate, and make the pagination trap mechanically impossible'
status: in-progress
created: 2026-07-26
priority: high
urgency: now
area: packages/agent-tools, packages/agent-framework, packages/pack-coding, packages/dag-nodes, scripts/harness, .github/workflows
depends_on: []
---

# SEC-007: the SEC-006 carry-over — enumeration containment, and a floor for the pagination trap

Closes the follow-ups [SEC-006](SEC-006-main-ref-alert-triage.md) identified and deliberately did
not fix.

## A — the file-tool sandbox did not cover the tools that enumerate

SEC-006's class sweep fixed `checkPathWithinCwd` to decide containment on the CANONICAL path, and
recorded that the guard reached `Read`/`Write`/`Edit` and stopped. Four surfaces resolved an
LLM-supplied root and never called it.

**A sandbox that stops you reading a file but lets you enumerate the filesystem around it is not a
sandbox.** And `Grep` is not merely enumeration: `outputMode: 'content'` returns the matching LINES,
so it stands in for the `Read` the guard was refusing.

### The structural cause, which is worse than the missing call

`Glob` and `Grep` were registered as MODULE-LEVEL SINGLETONS — `globTool`, `grepTool` — by both
assemblies (`agent-framework/src/assembly/create-tools.ts`, `pack-coding/src/coding-pack.ts`). A
singleton is context-free by construction: the factories took no `cwd`, so there was nothing to bind
a containment root to. `pack-coding` makes `cwd` REQUIRED precisely so the file-tool guard cannot be
disarmed by omission (`ICodingPackOptions.cwd`), and then contributed two tools that could enumerate
anywhere on the host. This is the same shape as SEC-006's R9: the guard existed, looked present, and
did not cover what it appeared to.

### Containment decided PER TOOL

Not the same guard applied by reflex — enumeration, content search and execution are different
operations, and one of them is genuinely better off uncontained.

| Tool                   | Decision                            | Reasoning                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Glob`                 | **contained**                       | Listing a tree is a disclosure in its own right. Root contained; symlinked directories not followed when armed (they are the escape AND a `link -> /` turns one call into a whole-disk walk); every RESULT re-checked, which is what catches a `..` or absolute pattern. |
| `Grep`                 | **contained, at least as strictly** | Enumeration _plus_ content disclosure. The walk drops any entry whose canonical path escapes, so a symlinked FILE's contents are refused too — not just a symlinked directory's listing.                                                                                 |
| `Shell` / `Bash`       | **NOT contained — deliberate**      | Arbitrary command execution. A `cwd` guard is undone by the first `cd ..`, so it constrains nothing while READING as a boundary in review. That is SEC-006's R9 lesson in the other direction. The real boundary is the permission layer and the sandbox seam.           |
| `dag-nodes/file-read`  | **contained to the invocation dir** | Path comes from a `.dag.json` — shareable and LLM-authorable. Had NO check at all, so an absolute path was honoured outright.                                                                                                                                            |
| `dag-nodes/file-write` | **contained to the invocation dir** | Same, and the serious half: `createDirs: true` is the DEFAULT, so it `mkdir -p`s the parent first. A shell profile or `authorized_keys` could be created and populated — "run this workflow" becomes code execution on next login.                                       |

The `Shell` exclusion is not a silent one. It is documented at the spawn site and pinned by a CONTROL
test that demonstrates a command escaping the root _without touching `workingDirectory` at all_, so
the next sweeper does not "fix" it by reflex.

What WAS wrong at that site and is fixed: the tool ignored the containment root it was constructed
with and ran every command in `process.cwd()`. `pack-coding` could scope its file tools to a
workspace while its `Shell` ran wherever the host process was started. The root is now the default
working directory; an explicit `workingDirectory` still wins.

### Everything routes through the shared implementation

`agent-core/src/utils/path-containment.ts` (`isPathInside` / `canonicalizePath`) remains the SSOT.
`agent-tools` asks it through one predicate, `isWithinCwd`, which `checkPathWithinCwd` also uses — so
the error-returning form and the skip-mid-walk form cannot diverge. The `dag-nodes` call it directly,
adding the `@robota-sdk/agent-core` edge the `dag-*` family already carries (`dag-framework`,
`dag-cli`). SEC-006 established that three divergent copies is its own defect; widening the guard's
reach must not re-create them.

### Red-first, on disk

Every test plants real symlinks and real out-of-root files. The pre-existing suites could not have
caught any of this: `agent-tools`' path-guard tests passed fictional path strings, and the `dag-nodes`
suites mock `node:fs/promises` — a mocked filesystem cannot contain a symlink.

Two CONTROL tests pin that the escape is real rather than hypothetical:

```
✓ CONTROL > Glob enumerates out-of-root files through the escaping symlink
✓ CONTROL > Grep returns the out-of-root file CONTENT through the escaping symlink
```

The contained cases before the fix — `agent-tools`:

```
× Glob > does not enumerate through a symlinked directory that escapes cwd
× Glob > refuses an explicit search root outside cwd            → expected true to be false
× Glob > refuses a search root reached through an escaping symlink
× Glob > resolves a RELATIVE search root against the sandbox root, not process.cwd()
× Grep > does not read a symlinked FILE inside cwd whose target is outside
× Grep > refuses an explicit search root outside cwd            → expected true to be false
 Tests  8 failed | 5 passed (13)
```

`dag-nodes` before the fix — 4 failed in each package, and the write cases asserted the planted file
really existed outside the root:

```
× file-write > refuses an ABSOLUTE path outside the invocation directory
× file-write > refuses a `..` traversal, and creates no directory on the way
× file-write > refuses to write through an escaping SYMLINKED DIRECTORY
× file-write > refuses to APPEND to an existing file outside the root
```

`Shell` before its fix: `expected '<repo>' to be '/tmp/sec007-shell-…/workdir'`.

**A note on the wrong turn SEC-006 recorded, because it applies here too:** rejecting `.`/`..`/
separator SEGMENTS makes traversal syntactically impossible and fixes nothing. A symlink named
`escape` is a perfectly plain segment. Segment validation is not containment.

Green after: agent-tools 239, pack-coding 11, agent-framework 1302, dag-node-file-read 8,
dag-node-file-write 9.

### The reachability floor

Because the defect was an unreachable guard rather than a missing one, the assertions are made
through the ASSEMBLIES, not the factories: `createDefaultTools({ cwd })` and `createCodingPack({ cwd })`
must each produce a `Glob`/`Grep` that actually refuses an out-of-root root. A test that only proved
a factory _can accept_ a `cwd` nobody passes would have been green throughout the vulnerable period.

## B — a mechanical floor for the pagination trap

SEC-006 named this the highest-value carry-over and could not build it (`scripts/**` was owned
elsewhere).

The code-scanning alerts endpoint sorts by `created` DESCENDING and pages at 100. SEC-005 had just
filed 98 `js/unused-local-variable` notes — the newest alerts in the repo — so they filled page one
exactly, and every security-severity alert sat on page two. A single-page query reported `0 high` on
**any** ref, which is byte-for-byte what a genuinely clean repository reports.

That is the second false all-clear from an unpaginated `gh api` here. What makes it survive a careful
reader is that truncation is **silent and indistinguishable from success**: no error, no gap, no
missing field — just a smaller number. Prose has already failed twice, which is why this is a scan.

### `scan-api-pagination.mjs`

Flags a `gh api` read of a paginated collection without `--paginate`, across `scripts/**` and
`.github/workflows/**`, in both the shell form and the argv form a Node harness script uses. Two
independent signals, either sufficient:

1. **a declared `per_page=`** — writing a page size is proof the author knew the endpoint pages;
2. **a known-paginated path** — which catches the more dangerous shape, no `per_page` at all, so the
   API's default of 30 silently applies.

Escape hatch `allow-unpaginated: <reason>`, accepted from the contiguous comment block above the
call; a reason-less annotation is itself a finding, mirroring the `allow-fallback`/`allow-fake`
anti-rot convention. Registered in `run-all-scans.mjs`.

### `github-api.mjs` — the reader the scan points at

`--paginate` is the fix, but a caller cannot tell from the output whether it worked, so every read is
CHECKED by whichever invariant the endpoint supports:

- **envelope endpoints** (`{ total_count, <items>: [] }`) — record count MUST equal `total_count`;
- **bare-array endpoints** (alerts, labels, branch rules) report no total, so the end of the walk is
  proven instead: the LAST page must be SHORT. A full final page cannot be distinguished from a walk
  that stopped early, and so is not something to pass.

Both throw. A read that cannot prove it is complete must not return a number a caller will treat as
authoritative.

### Every single-page query found, and what was done

| Site                                                   | Verdict                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-gate.yml` `/commits/:sha/check-runs`           | **fixed** — 21 check runs on a current PR head against a 30-per-page default. Truncated, either `total` is 0 and the gate says "nothing analysed", or a partial page makes `total == done_count` and it reports COMPLETE while an analysis is still running. Now via `github-api.mjs`, which can check this one against `total_count`. |
| `review-gate.yml` `/issues/:n/labels`                  | **fixed** — pages at 30; an acknowledge label on page two would read as absent, disabling the gate's only documented override. `--paginate`.                                                                                                                                                                                           |
| `review-gate.yml` `/code-scanning/analyses?per_page=1` | **annotated** — a genuine single-record existence probe; the response is asked `length != 0` and nothing else, so page two could not change the answer.                                                                                                                                                                                |
| `scan-main-required-checks.mjs` `/rules/branches/main` | **fixed** — read through a `spawnSync` argv with no pagination. A rule on page two would be reported as ruleset drift that does not exist.                                                                                                                                                                                             |
| `review-gate.yml` alerts queries (×2)                  | already `--paginate` (SEC-006).                                                                                                                                                                                                                                                                                                        |

### Proof

The scan's red/green is against the reconstructed query itself, and the reader's red/green is against
SEC-006's measured corpus (98 notes + 2 warnings filling page one, 40 high behind them, 171 total):

- single-page read → **0 high**, with 40 open;
- paginated read → **171 records, 40 high**;
- a runner that stops on a full page → throws `the end of the collection was never observed`;
- an envelope short read → throws `read 1 records but the API reports total_count=21`.

21/21. `pnpm harness:self-check` passes; `scan-api-pagination` is green on the tree.

## C — the two items SEC-006 flagged as needing a judgement call

### C1 — `apps/agent-server` playground trust boundary: **FILED, not fixed**

Investigated in full. Every mechanical claim in SEC-006 holds except one, and the severity is
UNDERSTATED rather than overstated.

- `playground-session-create.ts` takes `systemPrompt` from an unauthenticated request body and it
  becomes `systemPromptBuilder: () => options.systemPrompt` (`interactive-session-init.ts:163`) —
  replacing the whole builder. **Correction:** AGENTS.md is not what is discarded. The handler
  already passes `bare: true`, which short-circuits `loadContext`, so the playground session never
  had AGENTS.md to lose. What the override uniquely discards is the **permission-mode disclosure**,
  the tool descriptions and the capability/command listings.
- The router's only middleware is `byokKeySanitizer`, a log-hygiene shim that never rejects; the
  server `listen(port)` with no host, i.e. `0.0.0.0`. The WebSocket path IS JWT-authenticated, which
  makes the HTTP gap look like an oversight rather than a decision.
- The bigger fact SEC-006 did not state: the same handler passes no `defaultTools` and no
  `sandboxClient`, so `createDefaultTools({ cwd: process.cwd() })` gives the session the full host
  tool set — `Shell`, `Bash`, `Write`, `Edit` — with `permissionMode` defaulting to
  `bypassPermissions`, where `evaluatePermission` returns `'auto'` for every tool including unknown
  ones. Chained with `POST /sessions/:id/submit` that is **remote code execution on the server
  host**, throttled only by a 100-req/15-min rate limit.

**Why filed and not fixed.** Every available remedy is a product decision I would be making for the
owner:

- _Add authentication_ — contradicts a completed, owner-approved item. `PROD-001` (done) specifies an
  anonymous BYOK playground: "API 키 입력 → Robota CLI 브라우저 체험", with a Phase 2 demo mode using
  the server's own key and no caller key at all.
- _Remove the host tool set_ — decides what the demo demonstrates.
- _Change the trust level / permission mode_ — decides the demo's fidelity.

**The filing is a BLOCKER, not a nice-to-have.** The exposure is prospective: there is no Dockerfile,
no `firebase.json`, and no deploy workflow reference for `agent-server` today, so it is not currently
reachable. But `WEB-005` (todo) exists to restore the marketing-site links, and its stated completion
condition is exactly "`play.robota.io` is live and reachable" — i.e. the moment WEB-005 closes, this
ships. There is no existing item covering agent-server HTTP auth: `SEC-001` is a different surface
(the `agent-transport-ws` loopback socket), and `apps/agent-server/openapi.yaml` declares no
`securitySchemes` at all.

Note that part A narrows two of the escape paths incidentally — `Glob`/`Grep` in a playground session
are now bound to the server's `cwd` instead of unbounded, and `Shell` now runs in that `cwd` rather
than wherever the process started. Neither is a substitute for the decision above.

**Owner call needed on:** (i) does the public playground authenticate at all, or is anonymity the
product; (ii) does a playground session get host `Shell`/`Write`/`Edit`, or a restricted tool set /
sandbox client; (iii) if it keeps them, does `agent-server` still bind `0.0.0.0`.

### C2 — `/memory add` → operator-voice system content: **PARTLY FIXED, remainder filed**

The loop is real and the citations are accurate, but SEC-006's stated mechanism is wrong in a way
that changes the fix. It says the Anthropic adapter "erases the `<recalled-memory>` block's 'this is
data, not instruction' framing". Reading the code: the adapter copies content byte-for-byte and
**preserves the tags**. There was no framing to erase — the tags were bare delimiters whose
documented purpose was to distinguish per-turn recall from the startup index. What the adapter
actually destroys is _positional_ provenance: `provider.ts:112-135` filters every `role: 'system'`
message out of the array and `'\n\n'`-joins them into the top-level `system` field, so a block
appended after the whole conversation lands concatenated onto the operator's static prompt.

**Fixed here** (defence in depth, and labelled as such in the code, not cited as a boundary): the
missing framing now exists and travels INSIDE the text, since that is the only part that survives the
flattening. Written once in `memory/memory-trust-framing.ts` so the three injection points cannot
drift, and the section title states whose voice it is. This matters because project memory sits at
priority 25 in the same `project-instructions` band as the operator-authored AGENTS.md (10) and
CLAUDE.md (20) — the model had no way to tell which of the three it wrote itself.

**Filed, not fixed** — the boundary-grade half, because it changes a user-facing command's permission
surface:

1. `memory-command-module.ts` sets `requiresPermission: false` alongside `modelInvocable: true`. The
   projected tool therefore lands in `mergedPermissions.allow` (`create-session.ts:199-216`), and
   `permission-gate` evaluates deny → **allow** → mode policy, so the allow-list hit returns `'auto'`
   before the mode matrix is consulted. A model-invocable WRITE is auto-approved **in `plan` mode**,
   where `Write` and `Edit` are hard-denied. Whatever the right answer is, the current state is
   inconsistent with itself.
2. `context-loader.ts:134` loads `MEMORY.md` into every session's system prompt **unconditionally**,
   falling back to `createFileSystemMemoryStore(cwd)` — while the per-turn recall path is off by
   default (`memory-enablement.ts:94`, `enabled ?? false`). So the `--no-memory` switch does not
   disable the injection that is in the higher-authority band. That is arguably broader exposure than
   the `<recalled-memory>` path SEC-006 focused on.
3. `appendFileSync` performs no XML/HTML escaping (`project-memory-store.ts:167-192`; whitespace is
   collapsed, which does neutralize multi-line heading injection). A single-line payload containing
   `</recalled-memory>` survives intact into the prompt.

### Also confirmed — `dag-adapters-sqlite`'s 22 failing tests

SEC-006 recorded these as "failing on a clean `origin/develop`". The count is right and the symptom
is right; the **characterisation is wrong**, and it is worth correcting because "a package is broken
on the integration branch" and "our install recipe hides a native build" call for opposite responses.

The `adapter is undefined` in `afterEach` is secondary. The original throw is in `beforeEach`, from
the adapter constructors:

```
Error: Could not locate the bindings file. Tried:
 → …/better-sqlite3@11.10.0/…/build/Release/better_sqlite3.node
 ❯ new SqliteQueueAdapter src/sqlite-queue-adapter.ts:41:15
```

The worktree's `better-sqlite3` has no `build/`, no `prebuilds/`, no `lib/binding/` — because
better-sqlite3 declares `"install": "prebuild-install || node-gyp rebuild --release"`, which is
exactly the lifecycle script `pnpm install --ignore-scripts` skips. Not an ABI mismatch: Node is
v22.14.0, `process.versions.modules` is 127, and the loader's last candidate is the matching
`node-v127-linux-x64` path — the right ABI, no file.

Proven environment-specific rather than inferred: re-running the identical 22 tests with
`better-sqlite3` aliased to the SAME version in the main checkout (where the binary exists) gives
`Test Files 2 passed | Tests 22 passed`. Same sources, same Node, only the native binary differs.

CI does not reproduce it — every job installs with `pnpm install --frozen-lockfile` and no
`--ignore-scripts`, and there is no `onlyBuiltDependencies` restriction, so the addon is built. **No
separate backlog item is warranted: nothing in the repository is broken.** The remediation is
`pnpm rebuild better-sqlite3` in a worktree installed with `--ignore-scripts`.

## Carried onward from SEC-006, still open

Not in this item's scope; recorded so they are not lost:

- `dag-framework/src/adapters/local-fs-asset-store.ts:263` joins a caller-supplied `assetId` on the
  read path (the write path mints a `randomUUID`).
- `agent-framework/src/git/git-branch.ts:48` — the fd-based read for the `lstat`/`readFileSync`
  divergence.
- `dag-cli/src/commands/run.ts:2258` — the unvalidated `--report-file` write.
- `agent-executor/.../scheduled-task-runner.ts` — unverified for R8's bare-shell-name pattern.
- `agent-playground`'s `IBlockMessage` reusing `role: 'system'` for tool-result rendering.

## Test Plan

- Per-package vitest suites for every touched package, foreground: `agent-tools` (239),
  `pack-coding` (11), `agent-framework` (1302), `dag-node-file-read` (8), `dag-node-file-write` (9),
  plus the harness suite for the pagination floor (21).
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm harness:verify-like-ci`. Per INFRA-056,
  `verify-like-ci` runs neither `build` nor package tests, so those are run separately and it is not
  treated as sufficient.
- Every fix carries a test that FAILS before it, with the failing output quoted above. The two
  enumeration CONTROL tests prove the escape is real on disk rather than assumed.
- Reverse-apply proof for the `Shell` default-cwd fix (the source hunk removed, the test goes red).

## User Execution Test Scenarios

**Scenario 1 — the agent cannot enumerate outside its workspace through a symlink.**
Prerequisites: a built CLI (`pnpm build`).
Steps:

```bash
mkdir -p /tmp/sec007/work && echo 'SECRET' > /tmp/sec007/outside.txt
ln -s /tmp/sec007 /tmp/sec007/work/escape
cd /tmp/sec007/work && robota
```

Then ask the agent to "list every .txt file you can find" and to "search all files for SECRET".
Expected: neither `Glob` nor `Grep` returns `escape/outside.txt`, and the `SECRET` line never appears
in a tool result. Asking it to read `escape/outside.txt` directly still returns
`Access denied: … is outside the working directory` (the SEC-006 behaviour, unchanged).
Cleanup: `rm -rf /tmp/sec007`.
Evidence: _to be filled after implementation_

**Scenario 2 — a workflow cannot write outside the directory it was run from.**
Prerequisites: a built `dag-cli`.
Steps: author a `.dag.json` with a `file-write` node whose `path` is `/tmp/sec007-escape/planted.sh`
(or `../escape/planted.sh`), then `dag run` it from a scratch directory.
Expected: the node fails with `DAG_VALIDATION_FILE_WRITE_PATH_OUTSIDE_ROOT` and **no file and no
directory is created** at the target. A node writing `./out/result.txt` still succeeds.
Cleanup: `rm -rf /tmp/sec007-escape`.
Evidence: _to be filled after implementation_

**Scenario 3 — the pagination floor blocks a single-page query.**
Prerequisites: a checkout of this branch.
Steps: add a line to any file under `scripts/` reading
`gh api "repos/o/r/code-scanning/alerts?state=open&per_page=100"`, then run
`node scripts/harness/scan-api-pagination.mjs`.
Expected: exit 1 with `[per-page-without-paginate]` naming that file and line. Adding `--paginate`
makes it exit 0 with `api-pagination scan passed.`
Cleanup: revert the added line.
Evidence: _to be filled after implementation_

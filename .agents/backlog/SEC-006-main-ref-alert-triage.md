---
title: 'SEC-006: triage the 40 high + 15 medium CodeQL alerts the develop-ref query hid, and fix at source'
status: in-progress
created: 2026-07-26
priority: high
urgency: now
area: packages, apps
depends_on: []
---

# SEC-006: CodeQL high/medium triage — and the query bug that hid them

## The ref discrepancy: there was never one

The premise that started this item — `?ref=refs/heads/develop` reports 0 high while
`?ref=refs/heads/main` reports 35 high — is **false**, and the explanation matters more than the
alerts, because the same mistake will hide the next batch.

Both refs carry the **identical** alert set. Measured 2026-07-26:

```bash
# WITHOUT --paginate (one page, 100 records)
$ gh api "repos/woojubb/robota/code-scanning/alerts?state=open&ref=refs/heads/develop&per_page=100" \
    --jq '.[] | .rule.security_severity_level // .rule.severity' | sort | uniq -c
     98 note
      2 warning

# WITH --paginate
$ gh api "repos/woojubb/robota/code-scanning/alerts?state=open&ref=refs/heads/develop&per_page=100" \
    --paginate --jq '.[] | .rule.security_severity_level // .rule.severity' | sort | uniq -c
      1 error
     40 high
     15 medium
     98 note
     17 warning
```

The alerts endpoint returns records sorted by `created` **descending**. SEC-005 had just filed 98
`js/unused-local-variable` notes, which are the newest alerts in the repo — so they fill the entire
first page. Every security-severity alert sits on page 2+. A single-page query therefore reports
zero high on **any** ref, and the `main` query only looked different because it happened to be run
with `--paginate`.

Confirmed the two refs agree, by alert number:

```bash
$ diff <(gh api ".../alerts?state=open&ref=refs/heads/develop&per_page=100" --paginate --jq '.[].number' | sort -n) \
       <(gh api ".../alerts?state=open&ref=refs/heads/main&per_page=100"    --paginate --jq '.[].number' | sort -n)
171d170
< 332
```

One note-level alert created on `develop` after the promotion commit. Nothing else differs.

The candidate explanations we set out to distinguish are all **ruled out**:

- **Not diff-informed analysis.** `gh api .../code-scanning/analyses` shows `refs/heads/develop`
  runs alternating between `results_count: 171, rules_count: 201` (full) and `0/0` (the cached
  no-relevant-change runs). The most recent full develop analysis (`c7170ddb1`, 171 results) and the
  main analysis (`a1a6bb830`, 170 results) are both full-tree, same 201 rules.
- **Not ref-scoped alert records.** Alert numbers are repository-global; `ref` filters which refs an
  alert is _observed on_, and all 170 are observed on both.
- **Not a different query suite.** Both are `/language:javascript-typescript`, `rules_count: 201`,
  from the same `.github/workflows/codeql.yml` (`queries: security-and-quality`).
- **Not default-setup behaviour.** The repo uses the advanced workflow, not default setup.

**Which ref to trust: either — but only with `--paginate`.** The ref is not the variable; pagination
is. `main` is not more authoritative than `develop`. Any future audit must paginate, and should
assert on the total record count rather than eyeballing the first page.

This is the second time an unpaginated `gh api` produced a false all-clear (SEC-003 measured ~170
alerts only because it paginated). A mechanical floor belongs in the harness — see Follow-ups.

## Scope

OWNED for this item: `packages/**`, `apps/**`. Alerts in `scripts/**` and `content/**` are triaged
below but **not fixed here** (another agent owns those paths); they are carried to SEC-007.

## Verdict table

40 high + 15 medium. `R` = real (fixed), `FP` = false positive (premise stated), `NF` = real but
deliberately not fixed here, `OOS` = out of owned scope.

| #              | Sev  | Rule                                          | Location                                                                        | Verdict             |
| -------------- | ---- | --------------------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| 57, 58         | high | `js/file-system-race`                         | `agent-cli/src/init/init-command.ts:185,189`                                    | FP                  |
| 59             | high | `js/file-system-race`                         | `agent-cli/src/remote-control/host-identity.ts:73`                              | **R**               |
| 60             | high | `js/file-system-race`                         | `agent-command/src/session/session-command.ts:98`                               | FP                  |
| 61             | high | `js/file-system-race`                         | `agent-command-workflows/src/__tests__/create-command.test.ts:136`              | FP                  |
| 62             | high | `js/file-system-race`                         | `agent-framework/src/git/git-branch.ts:48`                                      | NF                  |
| 63, 64, 65     | high | `js/file-system-race`                         | `agent-framework/src/memory/project-memory-store.ts:185,188,189`                | FP                  |
| 67             | high | `js/file-system-race`                         | `agent-tools/src/builtins/read-tool.ts:147`                                     | FP (but see **R3**) |
| 68             | high | `js/file-system-race`                         | `dag-cli/src/commands/migrate.ts:100`                                           | FP                  |
| 69, 70, 71, 72 | high | `js/file-system-race`                         | `scripts/**`                                                                    | OOS                 |
| 27, 28, 29     | high | `js/path-injection`                           | `agent-cli/src/modes/serve-monitor-ui.ts:99,106,112`                            | FP (but see **R1**) |
| 30, 31         | high | `js/path-injection`                           | `agent-session/src/session-log-replay.ts:32,35`                                 | FP                  |
| 32, 33         | high | `js/path-injection`                           | `agent-session/src/session-store.ts:110,114`                                    | **R2**              |
| 116            | high | `js/insecure-temporary-file`                  | `agent-framework/src/adapters/node-file-system.ts:38`                           | FP                  |
| 176, 177, 178  | high | `js/insecure-temporary-file`                  | `dag-cli/src/commands/{lock,keys,perf}.ts`                                      | FP                  |
| 181, 182, 183  | high | `js/insecure-temporary-file`                  | `dag-cli/src/commands/tutorial.ts:151,374,619`                                  | FP                  |
| 11, 12         | high | `js/system-prompt-injection`                  | `agent-provider-anthropic/src/anthropic/{message-converter,provider}.ts`        | FP                  |
| 13–16          | high | `js/system-prompt-injection`                  | `agent-provider-openai-compatible/.../message-converter.ts:77,87,102,116`       | FP                  |
| 3, 4           | high | `js/insecure-randomness`                      | `agent-framework/.../create-session.ts:101`, `agent-session/src/session.ts:120` | FP                  |
| 1              | high | `js/insecure-helmet-configuration`            | `apps/agent-server/src/app.ts:39`                                               | **R** (hardened)    |
| 25, 26         | high | `js/clear-text-logging`                       | `scripts/examples/deepseek-provider-demo.mjs`                                   | OOS                 |
| 5, 6, 7, 8     | med  | `js/shell-command-constructed-from-input`     | `dag-cli/src/commands/studio.ts:18,20,21,77`                                    | **R**               |
| 56             | med  | `js/indirect-command-line-injection`          | `dag-cli/src/commands/studio.ts:22`                                             | **R** (same fix)    |
| 53             | med  | `js/indirect-command-line-injection`          | `apps/action/src/index.ts:29`                                                   | **R4**              |
| 54             | med  | `js/indirect-command-line-injection`          | `agent-core/src/hooks/executors/command-executor.ts:38`                         | FP                  |
| 55             | med  | `js/indirect-command-line-injection`          | `agent-tools/src/builtins/shell-tool.ts:152`                                    | FP                  |
| 10             | med  | `js/shell-command-injection-from-environment` | `agent-executor/.../managed-shell-process-runner.ts:105`                        | **R**               |
| 9              | med  | `js/shell-command-injection-from-environment` | `content/v2.0.0/scripts/generate-api-docs.js:158`                               | OOS                 |
| 73             | med  | `js/file-access-to-http`                      | `agent-core/src/hooks/executors/http-executor.ts:45`                            | FP                  |
| 74             | med  | `js/file-access-to-http`                      | `dag-cli/src/telemetry.ts:166`                                                  | FP                  |
| 75             | med  | `js/file-access-to-http`                      | `dag-framework/src/adapters/local-fs-asset-store.ts:80`                         | **R**               |
| 52             | med  | `js/http-to-file-access`                      | `dag-cli/src/commands/run.ts:2233`                                              | NF                  |
| 2              | med  | `js/stack-trace-exposure`                     | `dag-cli/src/studio/http-server.ts:53`                                          | FP (but see **R5**) |

## False positives — the premise that fails

Recorded here, **not dismissed in the GitHub UI**, per SEC-003/SEC-004 practice.

### `js/insecure-temporary-file` ×7 — the path is never in the OS temp dir

The rule's premise is a predictable filename inside the shared, world-writable OS temp dir. Not one
of the seven sites builds a path from `os.tmpdir()` or a `/tmp` literal. Every one resolves under a
caller-supplied `cwd` defaulting to `process.cwd()`:

- `dag-cli/src/commands/keys.ts` → `join(cwd, '.dag', '.env')` (`keys.ts:527`)
- `dag-cli/src/commands/lock.ts` → `join(cwd, '.dag', 'dag.lock')` (`lock.ts:55-57`)
- `dag-cli/src/commands/tutorial.ts:151` → `join(cwd, '.dag')` + `.env` (`tutorial.ts:130-131`)
- `dag-cli/src/commands/tutorial.ts:374` → `join(cwd, '.dag/.tutorial-complete')`
- `dag-cli/src/commands/tutorial.ts:619` → `join(cwd, 'tutorial-examples')` — the owner's own
  spot-check, confirmed
- `dag-cli/src/commands/perf.ts:371` → the user's literal `--output <path>` argv value
- `agent-framework/src/adapters/node-file-system.ts:38` → a one-line `writeFileSync` pass-through
  adapter with **no path expression at all**

**What actually tainted the analysis: test fixtures.** `dag-cli`'s command tests pass a literal
`'/tmp/fake'` as `cwd` (`keys-command.test.ts:29,36,42,…`, `lock-command.test.ts:68,77,85,93`,
`misc-commands.test.ts:89`), and `agent-framework`'s interactive tests pass `cwd: '/tmp'` at ~24 call
sites. CodeQL propagated the test-only constant into the product path. The predictable filenames
(`.dag/.env`, `dag.lock`) are deliberate, user-discoverable project files, and are not in a shared
directory. The repo already did the genuine remediation under SEC-003 (`dag-cli/src/utils/temp-workspace.ts`
plus three `no-insecure-temp-path.test.ts` regression floors).

### `js/system-prompt-injection` ×6 — a provider adapter is not the trust boundary

All six sites are inside `convertMessage`-style functions whose entire job is translating an
already-role-tagged `TUniversalMessage[]` into a vendor wire format. `openai-compatible/message-converter.ts:77`
is `role: 'system' → { role: 'system', content }`; `:87` is the `tool` branch; `:102`/`:116` are the
assistant branches. `agent-provider-anthropic/provider.ts:117` concatenates the messages the caller
already marked `role: 'system'`.

The rule's premise is that untrusted input is _interpolated into_ a system prompt, letting a user
override operator instructions. Here there is no interpolation and no role decision — the role was
assigned upstream. An adapter cannot distinguish trusted from untrusted content and must transmit
faithfully; sanitizing here would corrupt every legitimate system prompt. This repo **is** an AI
agent: a prompt assembled from history is its normal operating mode.

The right question — _can lower-trust content acquire the `system` role upstream?_ — was swept
separately. Findings are recorded under Follow-ups (SEC-007); none of them is at these six lines,
so fixing these lines would be fixing the wrong file.

### `js/file-system-race` ×8 — no privilege boundary to race across

CWE-367 requires an attacker who can swap the path between check and use and thereby gain something.
`init-command.ts` writes `<cwd>/.robota/settings.json` and `<cwd>/AGENTS.md`; `session-command.ts`
writes `<cwd>/.robota/budget.json`; `project-memory-store.ts` writes `<cwd>/.robota/memory/`;
`migrate.ts` writes a path the invoking user typed. All are the invoking user's own project or home
directory, and robota runs unprivileged as that user. A same-user process that can swap those files
can simply write them directly — the race grants no escalation. `create-command.test.ts:136` is
test-only and its directory comes from `mkdtemp`, which is mode `0700` and unpredictably named.

`read-tool.ts:147` is likewise not a _race_ problem — `stat` and `readFile` both follow symlinks, so
they resolve identically. Its real defect was the containment check itself (**R3**).

### `js/path-injection` ×5

- `serve-monitor-ui.ts:99,106,112` — a traversal guard is present and correct at
  `serve-monitor-ui.ts:95`: `filePath !== webRoot && !filePath.startsWith(webRoot + sep)` over a
  `normalize(join(...))` result, with `webRoot` absolute from `fileURLToPath`. CodeQL does not model
  this barrier shape. (Its neighbouring crash bug was real — **R1**.)
- `session-log-replay.ts:32,35` — `loadSessionLogEntries(logFile)` takes a whole path, not a
  segment, and its only direct caller is the `--session-log <path>` CLI flag, where the user names
  the file outright. There is no traversal concept in "the user opened the file they asked for". The
  _derived_ call site in `session-persistence.ts` was real and is fixed under **R2**.

### `js/indirect-command-line-injection` ×2 and `js/file-access-to-http` ×2 — designed behaviour

- `command-executor.ts:38` and `shell-tool.ts:152` both use `spawn` with an **argv array** and no
  `shell: true`; the shell string is passed as one argv element to `sh -c`. Running a configured
  command _is_ the hook system's contract, and running a shell command _is_ the `Shell` tool. There
  is no concatenation to exploit. Containment for the tool is the permission layer and the sandbox
  seam (`shell-tool.ts:135`), not this line.
- `http-executor.ts:45` posts to a URL the user wrote in their own `settings.json`; `telemetry.ts:166`
  posts to the hardcoded constant `TELEMETRY_ENDPOINT` (`telemetry.ts:14`) and is opt-in and
  CI-disabled. Neither URL is attacker-chosen.

### `js/insecure-randomness` ×2 — the id is not a credential

`session_<ts>_<base36>` is a local correlation id: it names a transcript file under the user's own
`~/.robota/sessions`, tags log lines, and rides along in hook payloads. It is never _compared_ for
authorization — no code path accepts a caller-supplied session id as proof of anything. Where the
repo does mint real secrets it already uses a CSPRNG: `agent-transport-ws/src/ws-connection-guards.ts:19`
(`randomBytes(32)` + `timingSafeEqual`), `agent-remote-pairing/src/pairing.ts:57,58,64,212`,
`apps/agent-server/.../playground-session-create.ts:187` (`crypto.randomUUID()` for the id that _is_
a capability). Guessing a `Math.random` correlation id grants nothing.

### `js/stack-trace-exposure` ×1

`grep -n stack packages/dag-cli/src/studio/http-server.ts` returns nothing: every reachable value is
`err.message` or `String(err)` (e.g. `ENOENT: no such file or directory`), and the router's catch-all
returns the constant `'Internal server error'`. No stack trace is ever serialized. The server binds
`127.0.0.1` only (`http-server.ts:494`). The same file _did_ carry a serious unflagged bug (**R5**).

## Real bugs fixed

### R1 — `agent-cli`: `GET /assets` crashes the monitor server (unauthenticated local DoS)

`packages/agent-cli/src/modes/serve-monitor-ui.ts`. The handler checked `existsSync(filePath)` and
then called `readFileSync(filePath)`. `existsSync` is true for a **directory**, and `readFileSync`
on a directory throws `EISDIR` synchronously inside the `createServer` callback — an uncaught
exception that terminates the process hosting the running agent. A built SPA always has
`dist/web/assets/`, so `GET /assets` is sufficient; `GET /.` resolves to `webRoot` itself for the
same effect.

The file already guards the analogous malformed-percent-encoding crash with the comment _"SEC-001
treats localhost as hostile, so a co-resident process must not DoS the running agent"_ — the
directory case was simply missed.

Failing test before the fix (`src/modes/__tests__/serve-monitor-ui.test.ts`):

```
⎯⎯⎯⎯⎯ Uncaught Exception ⎯⎯⎯⎯⎯
Error: EISDIR: illegal operation on a directory, read
 ❯ Server.<anonymous> src/modes/serve-monitor-ui.ts:112:13
    112|     res.end(readFileSync(filePath));
 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
```

Fix: require `statSync(filePath).isFile()` and read inside the same `try`, so any failure — missing,
unreadable, a directory, or concurrently replaced — is a 404 rather than a crash. This also removes
the stat-then-read race by construction. Now 9/9.

### R2 — `agent-session`: unauthenticated remote path traversal, read **and** write

`packages/agent-session/src/session-store.ts:73`, `filePath(id)` = ``join(this.baseDir, `${id}.json`)``
with no validation, reached by `save` (write), `load` (read), `delete` (`unlinkSync`) and
`getFilePath`.

`POST /api/playground/sessions` (`apps/agent-server/src/routes/handlers/playground-session-create.ts`)
takes `resumeSessionId` straight from the request body and validated it only as
`typeof resumeSessionId === 'string' && resumeSessionId` — which rejects exactly `""` and non-strings.
The route has **no authentication middleware** (`apps/agent-server/src/routes/playground.ts:13-16`)
and the server binds all interfaces (`server.ts:44`, `listen(port)` with no host). The value then
becomes the session's own id (`interactive-session-init.ts:132`, `session.ts:119`), so it reaches
`save()`'s `writeFileSync` + `renameSync` as well as the read path.

The CLI was safe only by accident: `--resume` resolves through `resolveSessionIdByIdOrName`
(`session-persistence.ts:73-81`), an existence-allowlist over `list()`. The HTTP handler bypasses
that helper entirely. Two further sinks share the same unvalidated value:
`FileSessionLogger.log` (``join(this.logDir, `${sessionId}.jsonl`)``) and
`ProjectSessionStoreFacade.loadFromReplayLog` (``join(this.logsDir, `${id}.jsonl`)``).

Failing tests before the fix (`src/__tests__/session-id-path-traversal.test.ts`) — 22 of 24,
including `delete() cannot unlink a file outside the store directory` and
`FileSessionLogger does not append to a path outside the log directory`.

Fix: a new `packages/agent-session/src/session-id.ts` validating the id as a single path component
(`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, ≤128 chars — admits no `/`, `\` or `:`, and cannot be `.` or `..`),
applied at all three sinks plus a 400 at the HTTP handler. It **rejects rather than sanitizes**:
rewriting `../x` to `__x` would alias two distinct ids onto one file and silently cross-link
sessions. Now 24/24, and the full `agent-session` (155) and `agent-framework` (1295) suites pass.

### R3 — `agent-tools`: the file-tool sandbox was escapable with a symlink (CodeQL did not flag this)

`packages/agent-tools/src/builtins/path-guard.ts`. `checkPathWithinCwd` compared `path.resolve()`
output, which is **purely lexical and does not resolve symlinks**. It is the only containment
boundary for `Read`, `Write` and `Edit` when no provider sandbox is injected — `pack-coding` makes
`cwd` a required option precisely because of that (`coding-pack.ts:23`).

So `<cwd>/link/secret` where `link -> /etc` satisfied `startsWith(cwd + sep)` while the subsequent
`readFile`/`writeFile` followed the link straight out of the sandbox. A symlink is ordinary committed
git content, so pointing the agent at an untrusted clone was enough to arm this — and for `Write`/`Edit`
it meant **creating files anywhere the process could reach**.

The pre-existing test suite could never have caught it: every case passed fictional path strings
like `'/project/root/src/index.ts'`, so no symlink was ever on disk.

Failing tests before the fix (`src/__tests__/path-guard.test.ts`, real filesystem):

```
FAIL > blocks reading through a symlinked DIRECTORY that escapes cwd
FAIL > blocks a symlinked FILE whose target is outside cwd
FAIL > blocks WRITING a new file through an escaping symlinked directory
      AssertionError: expected undefined not to be undefined
 Tests  3 failed | 11 passed (14)
```

Fix: canonicalize both sides with `realpathSync`, walking up to the deepest existing ancestor and
re-attaching the non-existent tail so `Write`/`Edit` targets that do not exist yet still work, and so
a cwd that is itself behind a symlink (macOS `/tmp -> /private/tmp`) does not spuriously deny. 14/14.

### R4 — `apps/action`: command injection from any GitHub issue body

`apps/action/src/index.ts:29` built a correct argv array and then destroyed it:
`execSync(args.join(' '))`. `execSync` always runs its string through a shell, so every metacharacter
in every input reached `/bin/sh`. The action's documented use is `task: ${{ github.event.issue.body }}`
— i.e. text any GitHub user can write — and the repository's `ANTHROPIC_API_KEY` is placed in that
process's environment at line 25.

Reproduced end to end before the fix:

```
--- VULNERABLE shape: execSync(args.join(" ")) ---
injected command ran (marker file exists)? true
--- FIXED shape: execFileSync(file, argv) ---
injected command ran (marker file exists)? false
```

Fix: `buildCliInvocation()` in a new `apps/action/src/build-invocation.ts` returns a file + argv
vector, executed with `execFileSync` and no `shell` option. Extracted to its own module because
`index.ts` runs on import and so cannot be imported by a test. Four new tests in
`__tests__/command-injection.test.ts`, including a CONTROL case that pins _why_ the fix is shaped
this way by demonstrating the old join-into-a-shell form still executes the payload. 6/6.

### R5, R6, R7, R8

Delivered in the same PR, each with its own failing-test evidence:

- **R5** `dag-cli` studio server — client-supplied `file` reached `resolve(cwd, file)` with no
  containment in `routeDag`/`routeRun`/`routeValidate`, while `jsonReply` set
  `Access-Control-Allow-Origin: *`. Any website the developer visited while `dag studio` ran could
  make the local server execute an arbitrary DAG and read the streamed result. Fixed with path
  containment, removal of the wildcard CORS (the UI is same-origin and never needed it), and a
  loopback `Host`-header check.
- **R6** `dag-cli/src/commands/studio.ts` — `exec` with a concatenated `open "${url}"` string
  replaced by an argv-vector spawn (alerts 5, 6, 7, 8, 56).
- **R7** `dag-framework/src/adapters/local-fs-asset-store.ts:80` — unvalidated
  `fetch(metadata.sourceUri)` where `sourceUri` originates in a task executor's output payload
  (`asset-aware-executor.ts:81`) and the body is streamed back to the caller: a clean SSRF. 18 tests
  failed before the fix — `file:///etc/passwd`, `data:`, `http://127.0.0.1:8080/admin`,
  `http://169.254.169.254/latest/meta-data/…`, `http://10.0.0.1/` and `http://[::1]/` all resolved,
  no abort signal was passed, and a 302 to `169.254.169.254` was followed. Fixed with a scheme
  allowlist, loopback/private/CGNAT/link-local rejection (including IPv4-mapped IPv6 in the
  `::ffff:7f00:1` hex form the URL parser normalizes to), a timeout, and **manual redirect following
  that re-validates every hop** — without which the initial check is cosmetic, since a public host
  can simply bounce the request onto the metadata endpoint. Obfuscated IPv4 (`http://2130706433/`,
  `0177.0.0.1`, `127.1`) is covered because WHATWG `URL` normalizes it before the check.
- **R8** `agent-executor/.../managed-shell-process-runner.ts:61` — `request.shell ?? 'sh'` resolved
  the bare name through a caller-influenceable `PATH`. Demonstrated before the fix: a test that
  writes an executable named `sh` into a temp dir and passes `env: { PATH: <thatDir> }` got
  `expected 'HIJACKED' not to contain 'HIJACKED'` — the caller-supplied `PATH` really did choose
  which `sh` ran. Routed through the repo's own `resolvePlatformShell()` SSOT, which reads the host
  env only, defaults to an absolute `/bin/sh`, and also fixes the hardcoded POSIX `-c` on Windows.
- Also: `apps/agent-server/src/app.ts:39` `contentSecurityPolicy: false` replaced with a restrictive
  API policy, and `agent-cli/.../host-identity.ts:73` switched to an `O_EXCL` (`flag: 'wx'`) write so
  the `mode: 0o600` on a private key cannot be silently skipped and a concurrent first run cannot
  discard the winning identity.

## Real but not fixed here

- **#62 `git-branch.ts:48`** — `lstatSync` says "regular file", then `readFileSync` re-resolves the
  name and _does_ follow symlinks, so the checked and read inodes are separate lookups. Genuine
  divergence, but the walk covers the user's own ancestors, the whole function is wrapped in a
  try/catch returning `undefined`, and the worst outcome is a wrong branch name displayed. Fixing it
  well needs an fd-based read; the cost is not justified by the impact. Carried to SEC-007.
- **#52 `run.ts:2233`** — the flagged `--save-as` write is already hardened by
  `/^[a-zA-Z0-9_-]+$/` (`run.ts:513`). The _adjacent_ `--report-file` write at `run.ts:2258` has no
  validation at all and writes partly-remote content to an arbitrary path; it is a larger change than
  this item's scope and is carried to SEC-007.

## Test Plan

- Per-package vitest suites for every package touched, run in the foreground: `agent-cli`,
  `agent-tools`, `agent-session`, `agent-framework`, `agent-command`, `agent-executor`, `dag-cli`,
  `dag-framework`, `apps/action`, `apps/agent-server`.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm harness:verify-like-ci`. Note INFRA-056:
  `verify-like-ci` runs neither `build` nor package tests, so those are run separately and it is not
  treated as sufficient.
- Each real bug carries a test that fails before its fix; the failing output is quoted per item above.
- Post-merge: re-query the alert count with `--paginate` on both refs and record the delta.

## User Execution Test Scenarios

**Scenario 1 — the monitor server survives a directory request (R1).**
Prerequisites: a built `agent-cli` (`pnpm --filter @robota-sdk/agent-cli build`).
Steps: run `robota --serve` (or `robota serve`) to start the monitor, note the printed
`http://127.0.0.1:<port>` URL, then `curl -i http://127.0.0.1:<port>/assets`.
Expected: `HTTP/1.1 404 Not Found`, and the agent process is still running and still serving — a
subsequent `curl -i http://127.0.0.1:<port>/` returns `200` with the injected `ws-url` meta tag.
Before the fix the first curl killed the process.
Cleanup: Ctrl+C.
Evidence: _to be filled after implementation_

**Scenario 2 — the file tools refuse to escape the workspace via a symlink (R3).**
Prerequisites: a built CLI and a scratch directory.
Steps: `mkdir -p /tmp/sec006/work && echo secret > /tmp/sec006/outside.txt && ln -s /tmp/sec006 /tmp/sec006/work/escape`,
then run robota with `cwd=/tmp/sec006/work` and ask it to read `escape/outside.txt`.
Expected: the `Read` tool returns `Access denied: "…" is outside the working directory`; the file
contents are never shown. A normal read of a file inside `work/` still succeeds.
Cleanup: `rm -rf /tmp/sec006`.
Evidence: _to be filled after implementation_

**Scenario 3 — a traversing resume id is rejected with a 400 (R2).**
Prerequisites: `apps/agent-server` running locally with any provider key.
Steps: `curl -i -X POST localhost:<port>/api/playground/sessions -H 'content-type: application/json'
-H 'X-Provider-API-Key: …' -d '{"provider":"anthropic","model":"…","resumeSessionId":"../../escaped"}'`.
Expected: `400` with `{"error":"Invalid \"resumeSessionId\" field"}`, and no file appears outside
`.robota/sessions/`. A well-formed id still resumes normally.
Cleanup: remove any created session files.
Evidence: _to be filled after implementation_

## Follow-ups (SEC-007)

1. **Mechanical floor for the pagination trap.** Any harness/CI step querying the code-scanning API
   must paginate; a check should assert the fetched record count matches the API's reported total.
   This is the root cause of the false all-clear, and prose will not prevent its recurrence.
2. **`apps/agent-server` system-prompt trust boundary.** `playground-execute.ts:108` pushes a
   caller-supplied `systemPrompt` as a `role: 'system'` message, and `playground-session-create.ts:182`
   lets a caller **replace the system-prompt builder outright** (`interactive-session-init.ts:163`),
   discarding AGENTS.md and the permission-mode disclosure. The same handler hardcodes
   `defaultTrustLevel: 'full'` and defaults `permissionMode` to `'bypassPermissions'`. These are
   product decisions, not analyser findings — they need an owner call, not a unilateral fix.
3. **Model-authored memory re-enters as operator voice.** `/memory add` is `modelInvocable: true`
   (`memory-command-module.ts:19`), writes verbatim to `.robota/memory/MEMORY.md`
   (`project-memory-store.ts:167-189`), and returns both in the system prompt (priority 25) and as a
   per-turn `createSystemMessage` (`execution-round.ts:87`, `execution-stream.ts:113`) — which the
   Anthropic adapter hoists into the top-level `system` field, erasing the `<recalled-memory>` block's
   "this is data, not instruction" framing. This is the one genuine tool-output→system-role loop.
4. `scripts/**` and `content/**` alerts (#25, #26, #69–#72, #9) — owned by another agent this cycle.
5. `git-branch.ts:48` fd-based read, and the unvalidated `--report-file` write at `run.ts:2258`.
6. `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts` may carry the
   same bare-shell-name pattern R8 fixed; it was outside this pass's file ownership and is unverified.
7. `dag-adapters-sqlite` has 22 failing tests on a clean `origin/develop` checkout in this
   environment (`adapter` undefined in `afterEach`) — pre-existing and unrelated to this item,
   confirmed by stashing all changes and re-running. It should not be left red indefinitely.
8. `agent-playground`'s `IBlockMessage` reuses `role: 'system'` for tool-result rendering
   (`block-messages.ts:64`); renaming it would stop it tripping this query.

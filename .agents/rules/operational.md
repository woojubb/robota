# Operational Rules

Rules for day-to-day development practices: error handling, documentation, task management, and
application boundaries (absorbed `api-boundary.md`, now a pointer stub).
Parent: [rules index](index.md)

### No Fallback Policy

- Fallback logic is prohibited. There must be a single, correct, verifiable path.
- No `try/catch` that silently switches to alternative implementations.
- No logical OR fallbacks for core behavior (`primary() || fallback()`).
- Terminal failure states must remain terminal by default.
- Retry or requeue is allowed only through an explicit policy gate, never as an implicit fallback.
- Public domain functions that can fail MUST return `Result<T, E>`. Throwing is reserved for truly unexpected programmer errors.

### Idea Capture Policy

- When the user mentions an idea, suggestion, or future task (e.g., "~하면 좋겠다", "나중에 ~하자", "~해야한다"), do NOT start implementation immediately.
- Instead, record it where future work actually lives: a backlog item in `.agents/tasks/` (per its README) or, for spec-shaped ideas, a spec-doc draft in `.agents/spec-docs/draft/`. Acknowledge briefly ("기록했습니다").
- Continue the current work without interruption.
- Only start implementation when the user explicitly requests it (e.g., "이거 진행해", "할일 목록에서 X 해줘").
- When the user asks to see the backlog ("할일 목록 보여줘"), list the recorded items from `.agents/tasks/`.

### Option Proposal Rule

- When presenting options to the user, always include a recommendation with rationale.
- For each option, evaluate and state the impact: affected files/packages, risk level, migration effort.
- Format: options → recommendation → impact assessment. Never present options without a clear recommendation.

### Feature Documentation Requirement

- When a new feature is implemented (new tool, new API, new command, new capability), documentation MUST be updated in the same commit or PR.
- WHICH documents a package change must update (SPEC.md, READMEs, robota.io source pages) is owned by
  [documentation-sync.md](documentation-sync.md) § Package Change Documentation Gate — it is not
  restated here. This rule adds the two obligations that gate does not carry:
  1. **Backlog/task cleanup** — move completed backlog items to `completed/`.
  2. **Stale content** — any existing documentation that contradicts the new feature MUST be corrected.
- A feature without documentation updates is an incomplete feature.
- This rule is enforced by `harness:scan:specs` which checks that SPEC.md exists and is non-empty for all published packages.

### Task/Backlog ID Convention

All backlog, spec-doc, and task files use an uppercase prefix ID in both the filename and the `title` frontmatter.

**Format:** `{DOMAIN}-{NNN}` — an uppercase domain prefix plus a zero-padded number. The domain
names the owning area (package, app, or cross-cutting concern); new domains may be introduced when
a new area appears. There is no separate `BL`/`TK` type segment.

**File naming:** `{ID}-{slug}.md`. The slug says what the item is about, in words:

```
.agents/tasks/CORE-014-shutdown-drops-in-flight-work.md
```

### Document Size Rule

- **Routing/index documents** — `.agents/rules/index.md`, `.agents/project-structure.md`, `AGENTS.md` — MUST stay lean (target under 80 lines). They route to detail; they do not inline it. When one exceeds the target, split detail into a focused sub-file and convert the original into a router; each sub-file keeps a `Parent:` link.
- **Detail rule documents** — rule catalogs (e.g. `common-mistakes.md`), gate specifications (e.g. `backlog-execution.md`, `spec-workflow.md`), and multi-section rule groups — are content documents consumed for their substance and are NOT bound by the 80-line target (same rationale as the skills exemption below).
- **Skills** (`.agents/skills/*/SKILL.md`) are exempt — procedural workflows agents consume in one pass.
- **Production source** size is governed separately by `code-quality.md` (300-line anti-monolith limit, enforced by `harness:scan` file-size).

### Search / Fetch Discipline

Adopted from the RCP conduct authority ([agent-conduct.md](agent-conduct.md) holds precedence).

- Do not search/look up stable, well-established facts already known. Search to verify anything
  that may have changed since training (current versions, library APIs, external status) before
  asserting it.
- Unrecognized-entity rule: before answering about a product, model, version, or technique not
  recognized, look it up — partial recognition is not current knowledge.
- Scale lookups to complexity (single fact → one; medium → a few; deep comparison → several); use
  the minimum needed.
- When the user names a URL or source, fetch that exact source; when snippets are insufficient,
  fetch the full content.

### Source Honesty & Tool Priority

- Never fabricate attributions; if the source for a statement is uncertain, omit it.
- Prefer repo-internal sources (code, specs, docs) over external search for repo-internal
  questions; combine when comparing internal vs external. Respect [research.md](research.md):
  third-party source code is not prior-art evidence — read the public doc it points to.
- Be appropriately skeptical of SEO-prone or contested results; re-search on conflict.

### Host Platform Is Read, Never Assumed

The host OS is a PROPERTY OF THE CURRENT SESSION, not of this repository. The same person runs this
repo on Linux and on macOS, and the platform can change between one session and the next — including
mid-conversation, when work moves to another machine.

- **Read the platform before recommending or writing a shell command.** The session environment
  states it; `uname -s` confirms it. Never carry a platform assumption over from an earlier session,
  an earlier message, or from what a checked-in script happens to contain.
- **A command handed to the user must run on THEIR current platform.** The divergent commands, each
  of which fails or silently misbehaves on the other OS:

  | Task            | GNU / Linux           | BSD / macOS                                 |
  | --------------- | --------------------- | ------------------------------------------- |
  | in-place edit   | `sed -i 's/a/b/' f`   | `sed -i '' 's/a/b/' f`                      |
  | absolute path   | `readlink -f p`       | `readlink` lacks `-f`; use `perl`/`python3` |
  | file mtime/size | `stat -c %Y f`        | `stat -f %m f`                              |
  | relative date   | `date -d '1 day ago'` | `date -v-1d`                                |
  | PCRE grep       | `grep -P`             | unsupported; use `rg` or `grep -E`          |
  | base64 no-wrap  | `base64 -w0`          | `base64` (no wrapping by default)           |

- **Checked-in scripts must be portable or explicitly platform-gated.** A script in `scripts/`,
  `.husky/`, or `.claude/hooks/` runs on whatever machine clones the repo. Prefer `node`/`python3`
  for anything with a platform-divergent flag; where a shell builtin is genuinely required, branch on
  `uname -s` and fail loudly on an unhandled platform rather than silently producing a wrong result
  (see "Silence is not success" in [enforcement-architecture.md](enforcement-architecture.md)).
- **When the platform cannot be determined, ask or detect — do not guess.** A command that silently
  does the wrong thing on the other OS is worse than a command that was never offered.

**Why this is a rule and not a preference:** a platform-wrong command does not error in a way that
names its cause. `sed -i` on macOS consumes the next argument as the backup suffix and reports
success, `stat -c` fails with an opaque usage line, `date -d` silently parses a different date. Each
looks like the command worked.

### File Handling Discipline

- Create files only when necessary; prefer editing an existing file over creating a new one; no
  proactive docs/README unless requested.
- On "fix/modify my file", edit the actual target file, not a new copy.
- Never claim a file exists or was produced without actually creating it; verify paths before
  asserting presence; surface deliverables explicitly (share the file, not a folder).

### A Bulk Edit Enumerates Through `git ls-files`

A bulk edit takes its file list from `git ls-files`, never from a filesystem walk. `git ls-files`
cannot return a `node_modules` path; a filesystem walk can, and in a pnpm workspace it does —
`packages/<a>/node_modules/@scope/<b>` is a symlink to `packages/<b>`, and `node_modules/.pnpm` holds
content hard-linked into every other project on the machine.

A write that lands there is unobservable, which is why this is a rule and not a preference: `git
status` does not look outside the work tree, every scan here reads `git ls-files`, and the store
survives `pnpm install` because it believes the content is already correct.

Four spellings follow symlinks, and each has a sibling that does not:

| refuse                            | use                              |
| --------------------------------- | -------------------------------- |
| `find -L`                         | `find`                           |
| `grep -R`                         | `grep -r`                        |
| `rg --follow`                     | `rg` (also honours `.gitignore`) |
| python `glob.glob` / `glob.iglob` | `pathlib.Path(...).rglob`        |

The python one is refused by its IMPORT as well as by its call — `from glob import glob` and
`import glob as g` bind the same enumerator to a name the call site does not spell. That half is
judged inside the PAYLOAD, so the identical text in JavaScript is not refused: `import glob from
'glob'` is a package this repository depends on and it does not follow. [INFRA-123](../tasks/completed/INFRA-123-nothing-can-name-the-language-of-an-embedded-payload.md) is why the
distinction is enforceable rather than stated; before it, the rule table would have claimed a scope
neither enforcer had a subject for.

Shell `**` under `globstar`, zsh `**`, and Node's `fs.globSync` do not traverse symlinked
directories and are unrestricted. `bulk-edit-guard.sh` refuses the four at the command and
`scan-symlink-following-enumeration` refuses them in a committed script. Only the hook resolves a
path, and only for a file-writing tool's own target: a redirect and an in-place editor are judged on
how the path is SPELLED, and the scan resolves nothing.

The declared exception is `BULK_EDIT_ACK=1`, after checking by hand where the enumeration reaches —
INLINE in the same command, or EXPORTED, which is the only form a file-writing tool can carry
because such a tool runs no command to put an assignment in front of. They differ in LIFETIME as well
as spelling: the inline form is scoped to the one command that carries it, and the exported one holds
for the rest of the session and covers the file-writing tools too. Prefer the inline form. Neither
reaches above the guard's payload refusals: an ack says a write was checked, not that an unreadable
payload was.

Enforced by: `bulk-edit-guard` (the command) and `symlink-following-enumeration` (the committed
script). The HOOK does not reach a python program passed through a heredoc — the body is masked as
quoted content, which is the blindness every guard in that directory has. The SCAN does reach one,
because in a committed file a heredoc body is ordinary file text. Neither reaches a two-step edit
that enumerates in one call and writes in the next. The scan reads a file whose extension says it is
a script, or — having no extension — whose shebang names an interpreter, so a script in a language
outside that list is unread.

Which files that is — and in which language — is owned by `scripts/harness/script-language.mjs`
([INFRA-115](../tasks/completed/INFRA-115-is-this-file-a-script-and-in-what-language.md)), where a
language's extensions ARE its interpreter map rather than a second list beside it. The obligation
this paragraph used to hand the reader — that three interpreter names had no matching extension, so
the same script was judged under one filename and clean under another — is discharged: there is no
longer a second place for the two halves to disagree.

The measurements behind the table, and the exposure they corrected, are in
[INFRA-105](../tasks/completed/INFRA-105-bulk-edits-reach-the-dependency-store.md).

### A Rewrite Edits What The Name RESOLVES To

A bulk rename decides by NAME: it greps for a symbol's spelling and rewrites every site that matches.
That is wrong whenever the name is not unique, which for ordinary names is most of the time. A
rewrite site is correct when the identifier at that position **resolves to the declaration being
changed** — not when it spells the same thing.

Measured: a rewrite adding `await` to `createSession(` call sites edited three files that define
their own local helper of that name and import nothing from the package that changed. Each was
reverted before it was committed, and it was caught by luck — the script printed what it touched and
the paths looked wrong for an unrelated reason.

This is a different failure from the enumeration one above, and a worse one. That rule bounds where
an edit can REACH; this is about whether the sites it reaches are the right ones. A rewrite sourced
correctly from `git ls-files`, staying inside `packages/*/src`, still edits every unrelated spelling
in the workspace — and produces no test failure when the local helper happens to be compatible, only
a silent semantic change. The enumeration failure announced itself in the printed paths. This does
not announce itself at all.

**Decide sites with `scripts/harness/resolve-rewrite-sites.mjs`, not with a grep.**

```text
node scripts/harness/resolve-rewrite-sites.mjs <symbol> <module> <file>...
```

Only a `binds` verdict may be rewritten. `shadowed-by-local-declaration`,
`does-not-import-the-symbol` and `imports-that-name-from-another-module` are the three ways a
same-spelled identifier is a different thing.

| verdict                                  | meaning                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `binds`                                  | the file imports the symbol from that module and nothing shadows it — rewrite |
| `shadowed-by-local-declaration`          | the file declares its own binding of that name — leave                        |
| `does-not-import-the-symbol`             | the name is not bound to anything from that module — leave                    |
| `imports-that-name-from-another-module`  | a different declaration with the same spelling — leave                        |
| `namespace-import-present-cannot-decide` | a namespace import of the target module is present — **decide by hand**       |

The last one exits non-zero on purpose. `ns.createSession(...)` is a real site the resolver cannot
see, and reporting it as "no" would silently skip it — the same silence as the name-based rewrite, in
the other direction.

**What it deliberately does not resolve**, stated rather than mis-answered: a re-export chain, a
namespace import used through an alias, and a symbol reaching the file through a barrel under a
different specifier. The accurate answer is a TypeScript program built once over the workspace, which
is also the slow one; reading each candidate file's own bindings covers the measured failure at a
cost a rewrite can afford per file. A resolver that guessed at the rest would be the regex it
replaces, wearing a better name.

Enforced by: nothing — a hand-written rewrite runs before any check can see it. There is no artefact
to scan and no command shape a hook can recognise, because the edit arrives as a finished diff. That
is an answer rather than a gap: a documented procedure plus a tool is what remains when a machine
cannot decide, and saying so is what distinguishes it from a rule nobody enforced and nobody noticed.

What exists instead is the tool above and this procedure. The reviewable evidence is the resolver's
output: a rewrite that names it in its record is one another reader can re-run, and one that does not
is a claim about scope with nothing behind it.

The measurement behind this rule is in
[INFRA-125](../tasks/completed/INFRA-125-a-rewrite-edits-what-the-name-resolves-to.md).

### A Wait Is Not Idle Time

While an actual asynchronous operation runs, advance already-authorized independent work only
when doing so does not delay the current batch's completion. A wait is not an obligation to open
another Task, branch, or review. Finish known integration and completion work before expanding
the work in progress; do not keep extending a batch to fill its waits. Respect a user's stop boundary.

Enforced by: `.claude/hooks/no-foreground-wait.sh` — it refuses a foreground Bash call whose sleep
budget exceeds 60 seconds, or that loops around a remote status read (`gh pr checks`, `gh run view`,
`git ls-remote`), and names the background path in the refusal. The hook exists because this section
alone did not hold: 61 turns died to Bash timeouts on that exact shape, and all four existing
PreToolUse Bash guards exit 0 on it. It fails toward PERMIT — it judges a cost, not a safety
property, so a wait it cannot parse is one it has no evidence about. Deliberate exception:
`FOREGROUND_WAIT_ACK=1` inline in the same command.

- **The wait must be real.** Something you cannot make faster and are not permitted to skip. A wait
  for work that has not started is not a real asynchronous wait. A notification does not start an
  idle or completed worker: use the runtime's start/resume operation for a work request, and rely
  on its accepted dispatch before waiting. Check dispatch once at the work boundary, not by repeated
  status polling or by requesting another review of unchanged content.
- **The second item must be INDEPENDENT** — no source file, no rule document and no frozen baseline
  in common with the one already in flight. Two changes to the same ratchet or registry are one
  item, whatever the backlog calls them.
- **Each item stays in its own worktree, on its own branch, in its own change proposal.** A shared
  tree makes the two changes one diff, and a reviewer can then judge neither.
- **Landing stays serial**, in the order the reviews finish. Parallel work is about the waiting, not
  about the merging.
- **Re-check the first item before returning to it.** Its review may have arrived while you were
  away, and the state you left is not the state you come back to.

Enforced by: nothing — repository scans cannot observe the runtime's dispatch acceptance or decide
whether interleaving delays a delivery. The runtime's dispatch result is the execution evidence;
an acknowledgment of a notification is not. Instrumentation remains tracked in
[HARNESS-077](../tasks/HARNESS-077-a-wait-leaves-no-trace.md); this guidance does not claim that a
repository check enforces provider-managed worker state.

**One thing to know about running the suite in a worktree.** A git hook exports `GIT_DIR` into
everything it launches, so a test spawned by a push-time gate can silently write to the repository
being pushed from rather than to its own fixture. The shared test configuration removes that ambient
context, and a floor asserts at run time that it is gone. Nothing further is required of you; it is
stated here because the rule above sends you into worktrees, where this failure mode is silent.

**Worktree hazards are refused at the command, not remembered.** The accidents in this class — a
command that reaches another repository, a checkout that cannot succeed followed by statements that
still run, a suite reading build output left by a different branch — are all silent when they happen
and expensive later, so none of them may depend on anyone reading this paragraph. They are refused by
`.claude/hooks/worktree-cwd-guard.sh` at the moment the command is issued, measured by
`scripts/harness/worktree-gate.mjs` in both phases, and judged by the two gates that wrap the work.
Enforced by: `worktree-cwd-guard` (hook) + `worktree-gate.mjs`, sequenced by
[`worktree-traffic-control`](../skills/worktree-traffic-control/SKILL.md).

If one of these reaches your work anyway, the first question is why the hook did not refuse it. A gap
closed at the hook is closed for everyone; a gap closed in prose is closed for whoever read it.

How to do it — partitioning file ownership before starting, worktree isolation, sequencing behind an
occupant, one self-verified proposal per item — is procedure, owned by
[`worktree-parallel-orchestration`](../skills/worktree-parallel-orchestration/SKILL.md). This rule
owns only WHEN it is mandatory: a blocking wait with an independent item available is not a
judgement call.

## API Boundary & Process Lifecycle

Absorbed from `api-boundary.md` (now a pointer stub).

### API Specification

- Applications with external API endpoints must maintain standardized API specifications (e.g., OpenAPI for HTTP). See `api-spec-management` skill for workflow details.

### Process Lifecycle

- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.

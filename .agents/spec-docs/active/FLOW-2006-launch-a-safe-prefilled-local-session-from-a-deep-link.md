---
status: in-progress
type: FLOW
tags: [flow]
lane: L2
---

# FLOW-2006: Launch a safe prefilled local session from a deep link

Paired with `.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`. Arising from [issue #2006](https://github.com/woojubb/robota/issues/2006), whose residual scope is owned by the umbrella [issue #2670](https://github.com/woojubb/robota/issues/2670).

## Problem

Nothing in this repository can turn a URL into a started session. `git grep -l 'robota://'` over
`packages/*/src` and `apps/*/src` returns zero files; the only URL-shaped surface is
`packages/agent-remote-pairing`, which attaches a device to a session that already exists rather
than starting one. The thirty-six command modules under `packages/agent-command/src/` include none
for this, and `packages/agent-cli/src/startup/preparsed-command-routing.ts` routes `doctor`,
`trust`, `usage`, `session analyze` and `eval` — there is no `open`.

The concrete symptom: a runbook, an issue, a dashboard or a teammate cannot hand someone a link that
opens Robota in the right directory with the prompt already typed. The reproduction is worse than a
missing feature. `robota open 'robota://open?v=1&prompt=hi'` does not print an unknown-command
error: `PARSE_ARGS_CONFIG` sets `allowPositionals: true`, only four positionals are branched on
(`init`, `user-local`, `eval`, `session analyze`), and anything else falls through — so the command
**starts an ordinary interactive session in the current directory and silently discards both
tokens**. The user asked to open a link and got an unrelated session with no indication that the
link was ignored. That the CLI accepts unknown positionals silently is its own defect, wider than
this item and filed as `CLI-2670`; what this item owns is that the `open` invocation must exist and must
refuse rather than drift.

There is a second, less visible half. Because no contract exists, there is also no rule saying what
a link may carry. A later implementation could accept `?provider=`, `?permission-mode=`,
`?plugin=` or `?allowed-tools=` and would be smuggling configuration into a session from a source
the user never audited — the exact failure the issue's fifth checklist line names. The contract is
therefore the deliverable, not a detail of one.

Two Robota-specific facts shape any answer. First, `packages/agent-cli` ships as an npm/volta
`bin` (`robota` points at `./bin/robota.cjs`), not an application bundle, so on macOS there is no
`Info.plist` to declare `CFBundleURLTypes` in. Second, the trust machinery this feature must respect
exists but does not cover the surface it needs: `packages/agent-framework/src/workspace-trust/`
persists `{ repositoryKey, worktreeRoot, state, generation, grantedAt }` grants to
`workspace-trust.json` and can `inspect` one identity at a time, while
`packages/agent-cli/src/startup/workspace-trust-admission.ts` — which knows `untrusted`, `revoked`,
`stale/replaced` and `store-unavailable` — is the **headless** gate, its only production caller
guarded by `if ((args.printMode || args.goal !== undefined || args.serve) && ...)`. The interactive
TUI has no trust decision point at all. What that means for this item is decided in § Decision, and
the defect itself is `TRUST-1989`.

## Prior Art Research

Researched 2026-09-20 by `prior-art-researcher` from product documentation only (no third-party
source code). `PRIOR_ART_RESEARCH: FOUND`.

| Product                              | What the documentation says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                     | Read       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Claude Code CLI deep links           | Scheme `claude-cli://`; `claude-cli://open` is "the only path the handler accepts". Params `q` (prefill, URL-encoded, max 5,000 characters), `cwd` (absolute; "Network and UNC paths are rejected, and so are paths that contain `..` segments or invisible or bidirectional control characters"), `repo` (`owner/name` resolved to a clone it has previously recorded). `cwd` wins over `repo`. "A deep link never executes anything on its own… nothing reaches the model until you read what was filled in and press Enter." A persistent `Prompt from an external link` line sits below the input until sent or cleared; above 1,000 characters it adds the character count and says to review. "Permission rules, `CLAUDE.md`, and trust prompts for the selected directory apply the same way as for any other session." | https://code.claude.com/docs/en/deep-links                                                                                 | 2026-09-20 |
| Claude Code handler registration     | Registered on the first prompt of an interactive session, "user-level locations only": macOS `~/Applications/Claude Code URL Handler.app`, Linux a `.desktop` entry under `$XDG_DATA_HOME/applications`, Windows `HKCU\Software\Classes\claude-cli`. The handler then picks a terminal emulator per OS. Opt-out via `disableDeepLinkRegistration`, enforceable in managed settings.                                                                                                                                                                                                                                                                                                                                                                                                                                            | same page plus https://code.claude.com/docs/en/settings-reference                                                          | 2026-09-20 |
| Claude Code VS Code extension        | Separate handler `vscode://anthropic.claude-code/open` with `prompt` ("pre-filled but not submitted automatically") and `session`. The only configuration-bearing action lives on a different path (`/install-plugin`) and opens a dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | https://code.claude.com/docs/en/vs-code                                                                                    | 2026-09-20 |
| OpenAI Codex app                     | `codex://new` and `codex://threads/new` accept `prompt` — "sets initial composer text (not auto-submitted)" — plus `path` (absolute workspace) and `originUrl` (match a workspace by git remote). Settings, plugins and skills are separate paths.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | https://learn.chatgpt.com/docs/reference/commands                                                                          | 2026-09-20 |
| GitHub Copilot app                   | `ghapp://session/new` with `repo` (required), `branch` or `pr` (mutually exclusive), `prompt`, `mode`. Publishes an HTTPS launcher wrapper because renderers strip custom schemes. Repeated warning: "Do not include secrets or sensitive user content in URLs." Configuration-bearing paths open a dialog that "does not create the automation until the user reviews the dialog and confirms".                                                                                                                                                                                                                                                                                                                                                                                                                               | https://docs.github.com/en/copilot/how-tos/github-copilot-app/open-with-deep-links                                         | 2026-09-20 |
| Gemini CLI and GitHub Copilot CLI    | No URL-scheme or deep-link surface is documented for either terminal CLI. Recorded as NONE_FOUND for this form factor rather than as evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | https://geminicli.com/docs/ , https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference     | 2026-09-20 |
| Slack                                | Deep links address IDs only — "these schemes do not support workspace subdomains, channel names, or user names" — and "unrecognized paths will fall back to `slack://open`".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | https://docs.slack.dev/interactivity/deep-linking/                                                                         | 2026-09-20 |
| macOS registration                   | A scheme is declared by `CFBundleURLTypes` in an app bundle's `Info.plist`; Electron restates that this "cannot be modified at runtime". The unit of registration is a bundle, not an executable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleurltypes                       | 2026-09-20 |
| Linux registration                   | A `.desktop` entry with `MimeType=x-scheme-handler/<scheme>`; `Exec` uses the field code `%u`, which "must not be used inside a quoted argument" and must not expand into multiple arguments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html                                            | 2026-09-20 |
| Windows registration and its warning | `HKCU\Software\Classes\<scheme>` with an empty-string `URL Protocol` value plus `shell\open\command`. "Security Warning: … the URI and other parameter values passed to the application may contain malicious data… Malicious parties could use additional quote or backslash characters to pass additional command line parameters… protocol handlers and their associated URI scheme must not rely on encoding."                                                                                                                                                                                                                                                                                                                                                                                                             | https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/platform-apis/aa767914(v=vs.85) | 2026-09-20 |
| OWASP MASTG and MASWE                | "Reject malformed URLs entirely rather than attempting partial processing", preventing exploitation of parsing differences; require explicit user confirmation for sensitive actions triggered by a deep link; "the whole URL must be discarded" when a parameter fails validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | https://mas.owasp.org/MASWE/MASVS-PLATFORM/MASWE-0029/                                                                     | 2026-09-20 |
| Electron second-instance             | "`argv` will not be exactly the same list of arguments as those passed to the second instance. The order might change and additional arguments might be appended." On macOS the URL arrives via `open-url`, whose listener is registered before `ready`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | https://www.electronjs.org/docs/latest/api/app#event-second-instance                                                       | 2026-09-20 |

**Observed common behavior.** One fixed verb path with a tiny allowlisted query; prefill universal
and auto-submit universally absent; two ways to say "where" (absolute path and repository identity)
with the path winning; existing trust and permission machinery reused verbatim rather than extended;
provenance surfaced in the UI and scaled to prompt length; configuration never riding the
session-open path; registration user-scoped and suppressible; argv treated as an untrustworthy
channel by three independent platform documents.

**Provider neutrality.** Across `claude-cli://open` (`q`, `cwd`, `repo`), `codex://new` (`prompt`,
`path`, `originUrl`), `vscode://anthropic.claude-code/open` (`prompt`, `session`) and
`ghapp://session/new` (`repo`, `branch`, `pr`, `prompt`, `mode`), **not one parameter names a
model, provider, endpoint, API key or credential**. The mapping table for Robota's providers is
therefore degenerate, and that is the finding: `agent-provider-anthropic`, `-openai`, `-gemini`,
`-bytedance`, `-openai-compatible`, `-replay` and `agent-builtin-providers` all map onto _nothing_ —
the intent resolves to a prompt and a workspace target and hands off to ordinary startup, so
provider selection keeps coming from profile resolution exactly as for `robota` typed at a shell.
"A provider with no equivalent" is not a reachable state, because the feature never reaches the
provider layer. The mechanical consequence is the allowlist below: a key that would influence
provider, model, endpoint, credentials, permissions, plugins, tools, hooks or skills is **rejected,
not ignored**.

**Checklist verdict (the issue's five gate lines, re-read 2026-09-20 — all five still hold).**

| #   | Line                                                                 | Verdict                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A URL scheme that launches a session with a prompt already filled in | Adopt — four independent products converge on prefill-by-query.                                                                                                                                                        |
| 2   | The target repository or working directory is part of the link       | Adopt both forms with path precedence; `repo` resolves only through locally recorded trusted state and never clones.                                                                                                   |
| 3   | Links are shareable                                                  | Adopt, scoped: shareability is a property of prompt plus repo slug, not of absolute paths. The HTTPS launcher wrapper that works around renderers stripping custom schemes is recorded as a follow-on, not built here. |
| 4   | Opening a link never runs anything unattended                        | Adopt as an invariant, with the external-origin notice and its long-prompt escalation — documented reference behavior tied to a documented threat, not decoration.                                                     |
| 5   | Malformed or untrusted link parameters cannot smuggle configuration  | Adopt and exceed: no reference documents rejecting _unknown_ keys, they are merely silent on extras. This spec rejects them, with OWASP's discard-the-whole-URL as the supporting evidence.                            |

**Where the references conflict**, they conflict on exactly one point: Slack falls back to
`slack://open` for unrecognized paths, Claude Code accepts one path and rejects everything else.
This spec takes the reject position, because a Robota link selects a filesystem working directory
and seeds model input, where fail-open is not defensible.

**Not claimed.** Apple's "Defining a custom URL scheme" body text was not retrievable, so the
scheme-collision point is recorded as a constraint to re-verify rather than quoted. JetBrains'
`jetbrains://` parameter contract and GitHub Desktop's `x-github-client://` are undocumented in
product documentation and support no decision here.

## Architecture Review

### Affected Scope

- `packages/agent-cli` — the launch-intent contract, its resolution against recorded trusted state, and the `robota open` pre-parse step.
- `packages/agent-ui-terminal` — a consumed-once initial composer value and the external-origin notice.
- `packages/agent-framework/src/workspace-trust/` — **modified, not merely consumed**: the trust store is identity-keyed (`inspect`/`grant`/`revoke`) and exposes no way to LIST grants, so `repo=` resolution needs a new read capability. It is defined here, beside the store it reads, rather than by re-parsing `workspace-trust.json` from `agent-cli` — a second parser over a security file is how two readers disagree.
- `@robota-sdk/agent-command` — consumed, not modified: `createGitProcess` / `IGitProcessPort` (BEHAVIOR-2437) is the argv-only git runner this item reuses. `agent-cli` already declares the dependency and the direction `agent-command` → `agent-cli` is the declared one. No third git runner is introduced.
- Unchanged: every provider package, every command module, `apps/agent-app`.

### Alternatives Considered

1. **Deliver the whole feature in one unit: contract, prefill, and OS registration on macOS, Linux
   and Windows.**
   - Pro: the link is clickable from a browser the day it lands, which is what a user would call
     "the feature".
   - Con: the registration half rests on an entirely different evidence base (Apple bundle rules,
     freedesktop field codes, the Windows registry and `ShellExecute` argument splitting, Electron
     `open-url` and `second-instance`), its failure modes are environmental and cannot be exercised
     in CI, and it forces two product decisions the contract does not — synthesizing a macOS `.app`
     for an npm-installed CLI, and choosing a terminal emulator. One PR would mix a pure,
     fully-testable parser with an OS-level installer.
2. **The launch-intent contract plus a thin `robota open <url>` caller and TUI prefill; OS
   registration deferred to a named follow-on.** (chosen)
   - Pro: every element is unit-testable with no OS state, platform-independent, and demonstrable
     end to end without registering anything anywhere. The strict contract lands BEFORE any handler
     exists, so a later registration PR cannot ship a looser parser — it inherits this one. It is
     also the shape the task's own plan already implies (bullets 1 to 3 versus bullet 4).
   - Con: until registration lands, a user must invoke `robota open "<url>"` (or point their own
     handler at it) — the link is not yet clickable from a browser. This is disclosed in the README
     rather than hidden.
3. **A prefill flag only (`robota --initial-input "..."`), with no URL contract.**
   - Pro: the smallest possible change; one option threaded to the composer.
   - Con: it does not deliver the unit the issue is about — a shareable link — and every consumer
     would invent its own encoding, leaving exactly the smuggling question (checklist line 5)
     unanswered. The flag is also strictly weaker than the chosen design, which needs the same
     threading anyway.
4. **Register the scheme in `apps/agent-app` (Electron) and drive the GUI.**
   - Pro: a real bundle exists there, and `electron-builder` documents a `protocols` key that writes
     `CFBundleURLTypes`.
   - Con: `apps/agent-app` is a different product surface from the CLI this issue is about, its
     artifacts are currently unsigned (its own `electron-builder.yml` header records that Gatekeeper
     and SmartScreen will warn), and the CLI — the surface the issue measures as absent — would gain
     nothing.

### Decision

**Alternative 2.** The deliverable is the launch-intent contract, its resolution, the caller and the
prefill; OS registration is explicitly out of scope and named as the follow-on.

**Delivery mode:** `single`

**Independent review record.** `proposal-reviewer`, three rounds against the live source
(2026-09-20): round 1 `REVIEW VERDICT: REVISE` (10 in-scope findings — four load-bearing premises
falsified, including that the trust gate this item claimed to reuse is headless-only and that grant
enumeration is an API that does not exist), round 2 `REVISE` (11 — the older sections still asserted
the premises the Decision had refuted), round 3 `REVIEW VERDICT: ENDORSE`, `DEPTH: LOCAL`. Ledger:
`.agents/loop-runs/backlog-execution-orchestrator.jsonl` run `r20260920080837`, `roundFindings:
[10, 11, 0]`. The foundational neighbour it surfaced is filed as `TRUST-1989` and contained here;
`CLI-2670` and `FLOW-2670` carry the other two separated concerns.

**The grammar, and nothing outside it.** The scheme must be `robota:`. Three spellings of the one
verb are accepted, because a platform handler chooses the spelling and the user does not:
`robota://open`, `robota://open/` and the authority-less `robota:open`. The verb is compared after
lowercasing, so `robota://OPEN` is the same verb; nothing else is — another host, a deeper path, a
fragment, or any query-less `robota:` URL is refused by naming what was found. Query keys are a
closed allowlist of exactly four: `v`, `prompt`, `cwd`, `repo`.

Lengths are counted in **Unicode code points** (`[...value].length`), not UTF-16 units and not bytes,
so an emoji or a Hangul syllable costs one wherever it appears — the boundary tests assert exactly
this.

- `v` is **required** and must be exactly `1`. A missing or different version is refused by name, so
  a future contract change cannot be mistaken for this one. No surveyed product versions its deep
  links; this is a Robota addition, and the reason it is worth the byte is that the parser is the
  security boundary — an unversioned boundary can only be widened silently.
- `prompt` is the prefill text, percent-decoded, at most **5,000 code points** after decoding
  (Claude Code's documented cap, adopted rather than invented). A `\r\n` pair is normalized to `\n`
  first, so a link authored on Windows or pasted out of a CRLF runbook is not refused for its line
  endings; a lone `\r` is refused, because it moves the cursor without moving the line and a prompt
  that rewrites its own rendering is exactly the class being excluded. Newlines and tabs are
  otherwise allowed, because a prompt legitimately contains them; every other C0 and C1 control
  character, and every Unicode bidirectional or invisible formatting character in the ranges
  `U+200B` to `U+200F`, `U+202A` to `U+202E`, `U+2066` to `U+2069` and `U+FEFF`, is refused — the
  class Claude Code names for paths, and the class that makes a rendered prompt lie about what it
  contains. A prompt whose first non-whitespace character is `/` is refused: see the prefill
  paragraph below.
- `cwd` is an absolute path. Refused: relative paths, UNC and network paths, any `..` segment, a NUL
  byte, and the same invisible and bidirectional class.
- `repo` is an `owner/name` slug, each part matching `[A-Za-z0-9._-]{1,100}` and neither part being
  `.` or `..`.
- When both `cwd` and `repo` are present, **`cwd` wins** — the documented precedence, stated so the
  behavior is not accidental.
- A **duplicate key is refused**, not last-wins: `?prompt=a&prompt=b` is ambiguous, and ambiguity at
  a security boundary is a defect. An **unknown key is refused**, not ignored — stricter than every
  reference surveyed, on OWASP's discard-the-whole-URL reasoning, and it is what makes "cannot
  smuggle configuration" true by construction rather than by review.
- The whole URL is capped at **8,192 code points** before parsing, so an overlong input is refused
  cheaply rather than decoded first.
- **Exactly one argument follows `open`.** Microsoft documents that a handler's command line can be
  extended by an attacker's quotes and backslashes, and Electron documents that a second instance's
  `argv` may arrive reordered with arguments appended. A second token after the URL is therefore
  refused rather than ignored — the cheapest hardening in this item, and the reason the contract
  lands before any handler does.
- Every refusal discards the **entire** URL, names the first rule violated, writes to stderr, exits
  non-zero and starts no session. Nothing is partially applied and nothing fails quietly.

**Resolution, against state the user already trusted.** `cwd` resolves through `realpath`, must be an
existing directory, and must already be `trusted` (the policy below). `repo` resolves **only** among
the grants the workspace trust store has recorded with state `trusted`.

Listing those grants is a capability that does not exist today: `IWorkspaceTrustStore` is
identity-keyed (`inspect`, `grant`, `revoke`) and `WorkspaceTrustService` is per-`cwd`. This item
adds `listGrants(): Promise<readonly IWorkspaceTrustGrant[]>` to the contract, implements it in the
node host beside the writer that already parses that file, and exports it — rather than re-parsing
`workspace-trust.json` from `agent-cli`. The capability is a real widening and is treated as one: it
hands its caller every local path the user has ever trusted, so it is read-only, returns the same
validated shape the store already enforces, and has exactly one production consumer.

For each recorded `worktreeRoot`, the origin remote is read with
`git -C <root> config --get remote.origin.url` through `createGitProcess()` — the BEHAVIOR-2437 port,
reused rather than reimplemented — and normalized to an `owner/name` slug (SSH `git@host:owner/name.git`
and HTTPS `https://host/owner/name.git` forms, `.git` optional). A clone with no `origin` is skipped,
not fatal: a repository without a remote simply cannot answer a slug.

**Worktrees are one repository, not many.** `identityKey` is `repositoryKey\0worktreeRoot`, so every
worktree of a repository is its own grant carrying the same `repositoryKey` and the same remote —
and this repository itself keeps worktrees under `.claude/worktrees/`, so a naive "two matches means
ambiguous" rule would refuse on the first real user. Candidates are therefore grouped by
`repositoryKey`: when one repository matches, the main worktree wins (the root whose `.git` is a
directory rather than a file), and only **distinct** repositories matching the same slug are an
ambiguity — refused, listing the candidate paths. A repository whose trusted grants hold no main
worktree at all — a bare repository with only linked worktrees — is refused rather than resolved by
picking one arbitrarily, because there is no defensible way to choose. Zero matches is a refusal naming the slug and
saying to open the link with `cwd=` or to run `robota` in that clone and trust it first.

A clone whose `origin` points at a personal fork does not match the canonical slug a runbook
publishes. That is stated rather than worked around: the link's `repo=` form addresses the remote the
user actually cloned from, and `cwd=` remains the exact form.

Robota never clones, never fetches, and never reads a repository the user has not already trusted —
which is stronger than the reference behavior, where `repo` resolves to any recorded clone and trust
is applied afterwards.

**Trust: the link may only open what the user has already trusted.** The premise that this feature
could "reuse the existing trust gate" is false, and the correction is the most important line in this
spec. `workspace-trust-admission.ts` is the **headless** gate: its only production caller is
`cli.ts` under `if ((args.printMode || args.goal !== undefined || args.serve) && …)`. The
interactive TUI has no trust decision point at all — an untrusted workspace starts anyway in
restricted mode (project settings, hooks, plugins and skills not loaded) with no prompt and no
refusal, and the only grant path is the out-of-band `robota trust --yes`. Since `robota open` is
interactive by its own design, there is nothing on its path to reuse.

The policy, therefore, is fail-closed and stated rather than inherited: **a launch intent resolves
only to a directory whose workspace trust state is already `trusted`**, for `cwd=` exactly as for
`repo=`. An untrusted, revoked, replaced or non-repository target is refused by name, with the
message naming `robota trust --yes` and the path. This makes the attacker-controllable form
(`cwd=`, an arbitrary filesystem path) no weaker than the recorded form, which is the inconsistency a
review of the first draft caught: the weaker form was the more dangerous one. It also costs nothing
a user did not already do — the directories they work in are the directories they have trusted.

`Contained — TRUST-1989.` The absent interactive trust decision point is a real defect that sits
beside this item, not under it, and it is filed as its own record rather than patched here. When
TRUST-1989 lands an interactive decision point, this refusal becomes a prompt; until then it is a
refusal, and the refusal is the safe direction.

**Prefill, never submit — and never a command.** The prompt is placed in the composer as its initial
value and no turn is created: the session makes zero provider calls until the user presses Enter.
Two corrections make that claim true rather than approximately true.

First, **a prompt that begins with `/` is refused by the parser**. `TuiInteractionChannel.handleInput`
routes any input whose first character is `/` to the slash-command path instead of the model, so a
link carrying `prompt=%2Fmode%20bypassPermissions` would change the permission mode locally on one
Enter — with zero provider calls, which is precisely the assertion a naive test would have passed.
The query allowlist closes the key channel; without this rule the prompt channel stays open and
"cannot smuggle configuration" would be false. The check is on the first non-whitespace character,
and the refusal says that a link may carry a prompt but not a command.

Second, **the seed is consumed-once controller state**, not an `InputArea` `useState` initializer.
`AppPresentation` unmounts the prompt subtree while a terminal handoff is suspended, so a component-
local initializer would re-seed the external prompt after the user had cleared or submitted it. The
initial value travels `render.tsx` → `App` → `useAppController` — the path `showSessionPickerOnStart`
already takes — and is marked consumed the first time the composer receives it.

Below the input, a persistent notice reads `Prompt from an external link` until the prompt is
submitted or cleared; above 1,000 characters it also carries the character count and tells the reader
to review the full text before sending — the documented reference behavior, tied to the documented
threat that a long prompt pushes its own instructions off screen.

**The caller is thin, and it is a pre-parse step rather than a subcommand.** Every route in
`preparsed-command-routing.ts` (`trust`, `doctor`, `usage`, `session analyze`, `eval`) TERMINATES the
process: `runPreparsedCliCommand` returning `true` means "handled, exit". `open` is the opposite — it
must continue into the ordinary interactive session — so it cannot live there without inverting that
contract. It runs instead at the top of `startCli`, before `const cwd = process.cwd()` is read
(`packages/agent-cli/src/cli.ts` line 80) and before `parseCliArgs()` sees the argv: the resolver
returns "not an open invocation", "refused" (message plus a non-zero exit, no session), or "launch"
with a resolved directory and the prompt. On launch the process changes directory to the resolved
target and the two tokens `open <url>` are removed from **`process.argv` itself, rewritten once in
place**, before anything reads it. That is deliberate rather than convenient: `parseCliArgs()`
defaults to `process.argv.slice(2)`, `runPreparsedCliCommand` is handed `process.argv`, and
`runEvalCommand` / `runSessionAnalyze` index it positionally — a locally filtered copy would leave
those readers disagreeing about the same fact, which is the argument this spec already uses to
refuse a second trust-file parser. Everything after that is the unmodified startup
path over the new directory — the same composition, the same render call plus two options. It is not
the trust gate: the resolver has already refused anything not `trusted`, which is what makes the
change of directory safe. The caller adds no provider, permission, plugin or tool decision of its own — it
cannot, because the parser refuses to carry any.

**Headless is a refusal, not a guess.** A prefill has no meaning where there is no composer, so
`robota open` without an interactive terminal refuses and says to run it in one. It does not
silently submit the prompt, which is the one behavior every reference forbids.

**Out of scope, filed rather than implied.** OS scheme registration on all three platforms
(including synthesizing a user-level macOS bundle and choosing a terminal emulator), the Electron
`open-url` and `second-instance` wiring in `apps/agent-app`, an HTTPS launcher wrapper for renderers
that strip custom schemes, and a `disableDeepLinkRegistration`-style opt-out (which has nothing to
suppress until registration exists) are **FLOW-2670**, a filed record under the same umbrella issue —
not a README sentence. A deferral whose follow-on exists only as prose is a deletion.

**Where the grammar lives, decided rather than defaulted.** The parser is a zero-dependency contract,
and `apps/agent-app` — the Electron surface FLOW-2670 will register the scheme on — may not depend on
`agent-cli`. It is nevertheless placed at `packages/agent-cli/src/launch-intent/` today, for one
reason: it has exactly one consumer, and a leaf package created for a consumer that does not exist
yet is a guess about a shape FLOW-2670 has not fixed. The move is not left to be discovered: extracting
the grammar to a zero-dependency leaf package is a named, required step of FLOW-2670, to be done when
the second consumer is real and can say what it needs. `encodeLaunchIntent()` stays module-internal
for the same reason — no caller exists — and the round trip is tested through the module's own
boundary rather than exported for a hypothetical one.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `packages/agent-cli` (contract, resolution, pre-parse caller), `packages/agent-ui-terminal` (consumed-once initial value, notice) and `packages/agent-framework/src/workspace-trust/`, which is MODIFIED: the store has no way to list grants and `repo=` resolution needs one (§ Affected Scope, Solution step 2, TC-07). `@robota-sdk/agent-command` is consumed unchanged for its git port.
- [x] Sibling scan 완료 — `preparsed-command-routing.ts` is the precedent for keeping a subcommand's own flags away from the strict global parser (`trust`, `doctor`, `usage`, `eval`) and is also the reason `open` does NOT live there: every route in it terminates the process, while `open` must continue into a session; `workspace-trust-admission.ts` is the precedent for refusing on an untrusted workspace with actionable text; `packages/agent-command/src/git/git-process.ts` (BEHAVIOR-2437) is the precedent for an injected argv-only git runner and is the shape the remote-url reader follows; `InputArea.tsx` line 92 (`useState('')`) is the composer's single value ORIGIN but not a durable one — `AppPresentation` unmounts the prompt subtree while a handoff is suspended — so the seed is owned by the controller (`useAppController`, the `showSessionPickerOnStart` path) and consumed once, not written into a component initializer; `render.tsx`'s `IRenderOptions` is where startup options already thread through `App`.
- [x] 대안 최소 2개 검토 완료 — four, each with a Pro and a Con; reviewed independently by `proposal-reviewer` (round 1 REVISE, 10 in-scope findings, all absorbed below).
- [x] 결정 근거 문서화 완료 — the split is the research's own recommendation, and the reason each rejected alternative loses is stated in its Con.
- [x] New-surface placement: **N/A** — no new package, app or interface surface. One new directory inside the package that already owns CLI startup, plus two options on an existing render-options type. No layer reclassification.

## Fallback & Degradation Declaration

- A malformed URL — wrong scheme, wrong path, missing or wrong `v`, unknown key, duplicate key, oversize URL or prompt, forbidden character, relative or UNC or `..` path, malformed slug: the **whole** URL is discarded, the first violated rule is named, and the process exits non-zero. Nothing is partially applied and no session starts.
- `cwd` names a path that does not exist or is not a directory: refused by name. Unlike the reference behavior, which opens the session anyway, Robota refuses — a session in a directory the link named but that is absent is a silent lie about where the work is happening.
- `repo` matches no trusted recorded clone: refused, naming the slug and the two ways forward (use `cwd=`, or run `robota` in that clone and trust it). Two or more DISTINCT repositories match: refused, listing the candidates — several trusted worktrees of ONE repository are not ambiguous and resolve to its main worktree. A repository whose trusted grants contain no main worktree (a bare repository with only linked worktrees) is refused rather than resolved by picking one. Never resolved by guessing, never cloned.
- The workspace trust store is unreadable or corrupt, during either the per-target check or the grant listing: refused, naming the store, because "could not check" is not "trusted".
- The resolved directory is untrusted, revoked or replaced: refused by name, with the path and `robota trust --yes`. There is no link-specific grant and no prompt, because the interactive surface has no trust decision point to prompt with (`Contained — TRUST-1989`).
- The resolved directory is not inside a git repository, so no workspace identity exists: refused, because a target with no identity has no trust state to be `trusted`.
- The prompt begins with `/`: refused, naming that a link may carry a prompt but not a command.
- A second argument follows the URL: refused, naming it.
- `git` is absent while resolving `repo`: refused naming that, because the slug cannot be checked; `cwd=` still works, and the message says so.
- No interactive terminal: refused with a message saying a prefilled session needs one. The prompt is never submitted headlessly.
- A `cwd` whose `stat` throws, and a clone whose `.git` cannot be read while grouping worktrees: both answer the fail-closed value (`undefined`, so the caller refuses the target by name; and "not the main worktree", so the grouping rule needs proof rather than assuming it). Both are declared at the site with `allow-fallback` — they degrade towards a refusal, never towards opening something unproven.
- No scheme is registered anywhere yet: the link is opened by passing it to `robota open`, which is the documented interim, and the README says so rather than leaving a browser click to fail mysteriously.

## Solution

1. `packages/agent-cli/src/launch-intent/launch-intent.ts`: `ILaunchIntent`, `TLaunchIntentParse`, `parseLaunchIntent(raw)`, the module-internal `encodeLaunchIntent(intent)` (tested through this module's boundary, not exported — no caller exists) and the limit constants (`LAUNCH_INTENT_VERSION`, `LAUNCH_INTENT_MAX_URL`, `LAUNCH_INTENT_MAX_PROMPT`, `LAUNCH_INTENT_KEYS`).
2. `packages/agent-framework/src/workspace-trust/`: `listGrants()` on `IWorkspaceTrustStore`, its node-host implementation beside the existing parser, the `IWorkspaceTrustGrant` type and the `index.ts` export.
3. `packages/agent-cli/src/launch-intent/resolve-launch-target.ts` (carrying `Contained — TRUST-1989.` at the trusted-only refusal): `resolveLaunchTarget(intent, deps)` over an injected `{ listGrants, inspectTrust, readRemoteUrl, statDirectory }`, with the remote read going through `createGitProcess()` from `@robota-sdk/agent-command`; slug normalization for SSH and HTTPS remotes; grouping by `repositoryKey`; the trusted-only rule; zero-match, ambiguous-repository and untrusted refusals.
4. `packages/agent-cli/src/launch-intent/open-invocation.ts`: `resolveLaunchInvocation(argv, deps)` — returns `{ handled: false }` for any argv that does not start with `open`, a refusal carrying the message and a non-zero exit code, or `{ cwd, initialInput }`; includes the non-interactive refusal.
5. `packages/agent-cli/src/cli.ts`: call it at the top of `startCli` (before `process.cwd()` is read and before `parseCliArgs()`), change directory on success, strip `open <url>` from the argv the strict parser reads, and thread the prompt into the render options.
6. `packages/agent-ui-terminal/src/render.tsx`: `initialInput?: string` and `initialInputOrigin?: 'external-link'` on `IRenderOptions`, threaded to `App` and into `useAppController` as consumed-once state (the `showSessionPickerOnStart` path), surfaced to `InputArea` as an initial value it takes exactly once.
7. `packages/agent-ui-terminal/src/external-prompt-notice.tsx` (new): the persistent notice and its long-prompt escalation, cleared when the prompt is submitted or the composer is emptied.
8. `packages/agent-cli/README.md` and `packages/agent-cli/docs/SPEC.md`: the contract, the interim `robota open` invocation, the trusted-only rule and the FLOW-2670 limitation; `packages/agent-ui-terminal/docs/SPEC.md`: the initial-value options and the notice; `packages/agent-framework/docs/SPEC.md`: `listGrants`.
9. Task `## Plan` renamed to the TC ids below.

## Affected Files

- `packages/agent-framework/src/workspace-trust/types.ts`, `node-host-workspace-trust.ts`, `index.ts`, `packages/agent-framework/docs/SPEC.md`
- `packages/agent-cli/src/launch-intent/launch-intent.ts` (new)
- `packages/agent-cli/src/launch-intent/resolve-launch-target.ts` (new)
- `packages/agent-cli/src/launch-intent/open-invocation.ts` (new), `src/launch-intent/index.ts` (new)
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/utils/cli-help.ts` (the `--help` catalogue that lists `doctor`, `trust`, `usage` and `eval` today), `packages/agent-cli/src/index.ts`, `packages/agent-cli/README.md`, `packages/agent-cli/docs/SPEC.md`
- `packages/agent-ui-terminal/src/render.tsx`, `src/App.tsx`, `src/hooks/useAppController.ts`, `src/InputArea.tsx`, `src/external-prompt-notice.tsx` (new), `docs/SPEC.md`
- `packages/agent-cli/src/launch-intent/__tests__/*.test.ts` (new), `packages/agent-ui-terminal/src/__tests__/external-prompt-notice.test.tsx` (new), `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` (new)

## Completion Criteria

- [x] TC-01: the grammar — `parseLaunchIntent` accepts `robota://open?v=1&prompt=hi`, the same with `&cwd=/abs/path`, the same with `&repo=owner/name`, the trailing-slash form, the authority-less `robota:open?v=1&prompt=hi` and the upper-case verb `robota://OPEN?v=1&prompt=hi`; and refuses, each naming the violated rule and returning no partial value: a non-`robota` scheme, `robota://openx`, `robota://open/extra`, a fragment, a missing `v`, `v=2`, an unknown key (`provider`, `permission-mode`, `allowed-tools`, `plugin`), a duplicate key, a URL of 8,193 code points, a decoded prompt of 5,001 code points (with a boundary case at exactly 5,000 that is accepted, counted in code points so one emoji counts once), a prompt carrying a NUL, an ESC, a lone `\r` or a right-to-left override, a prompt whose first non-whitespace character is `/`, a relative `cwd`, a `cwd` containing `..`, a UNC `cwd`, and a malformed `repo` slug. A `\r\n` in the prompt is normalized to `\n` and accepted.
- [x] TC-02: precedence and round trip — with both `cwd` and `repo` present the parse result carries `cwd` as the target and records that `repo` was superseded; `encodeLaunchIntent(parseLaunchIntent(url))` reproduces a URL that parses to the same intent for prompts containing spaces, newlines, `&`, `=`, `#`, `%` and non-ASCII characters.
- [x] TC-03: resolution — the trusted-only refusal in `resolve-launch-target.ts` carries the literal containment label `Contained — TRUST-1989.` at the site, and the commit that lands it repeats the label in its body; a `cwd` that exists, is a directory and is `trusted` resolves to its realpath; a `cwd` that does not exist, is a file, has no workspace identity, or whose trust state is `untrusted`, `revoked` or `stale/replaced` is refused by name, with the path and `robota trust --yes`; `repo` resolves to the single trusted repository whose origin remote normalizes to the slug across the SSH, HTTPS and `.git`-less forms; several trusted worktrees of the SAME repository resolve to the main worktree rather than being called ambiguous, while two DISTINCT repositories matching one slug are refused with the candidate list; a grant whose state is not `trusted` is not a candidate; a clone with no `origin` is skipped rather than fatal; an unreadable grant store and a missing `git` runner are each refused naming the cause.
- [x] TC-04: the caller — `resolveLaunchInvocation` returns `handled: false` for `robota`, `robota --help` and `robota opener`; with a valid link it returns the resolved cwd and the prompt and nothing else; a second argument after the URL is refused; every refusal writes to stderr, carries a non-zero exit code and launches nothing; a non-interactive terminal is refused with the terminal message; the two tokens `open <url>` are removed from the argv handed onward; the resolution runs before any workspace composition, so trust is never resolved for the directory the process happened to start in.
- [x] TC-05: prefill and provenance — `renderApp` threads `initialInput` through the controller into the composer so the first frame shows the prompt with the cursor after it and no turn started; the seed is consumed once, so a remount of the prompt subtree (the handoff-suspend path) does not re-seed a prompt the user cleared or submitted; the notice renders `Prompt from an external link` while the value is unchanged, adds the character count and the review sentence above 1,000 characters, and disappears once the prompt is submitted or the composer is emptied; with no `initialInput` neither the value nor the notice is present.
- [x] TC-06: wiring — `startCli` consults `resolveLaunchInvocation` before `parseCliArgs()`, `robota --help` lists `open <url>` with its usage line (because `robota open --help` is itself refused by the exactly-one-argument rule, the help catalogue is where the form is documented), and the name `open` is claimed nowhere else (no command module, no other subcommand route).
- [x] TC-07: the trust-store capability — `listGrants()` returns every recorded grant with its state, path and generation from a fixture store; a corrupt store throws the store's existing corrupt-file error rather than returning a partial list; the method is read-only (a call leaves the file byte-identical); it is exported from `packages/agent-framework/src/workspace-trust/index.ts`.
- [x] TC-08: engineering verification — build, test and typecheck for the affected packages exit 0; `pnpm harness:scan` exits 0, with any inherited failure reported rather than hidden; the lint-warning ceiling holds.
- [x] TC-09: the built binary in a PTY over a temporary trusted repository: `robota open` with a `v=1` link carrying a prompt and that directory as `cwd` starts in that directory with the prompt visible and unsent, the external-link notice present, and no provider call recorded; pressing Enter submits it; a link carrying `provider=` is refused on stderr with a non-zero exit and no session; a link whose prompt is `/mode bypassPermissions` is refused, and the permission mode is unchanged afterwards; an untrusted directory is refused naming `robota trust --yes`, and no session starts.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                | Notes                                           |
| ----- | ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------- |
| TC-01 | Unit                     | Vitest over `parseLaunchIntent` with a table of accept and refuse inputs       | Each refusal asserts the named rule             |
| TC-02 | Unit                     | Vitest round trip over `encodeLaunchIntent` and `parseLaunchIntent`            | Includes newline and non-ASCII prompts          |
| TC-03 | Unit                     | Vitest over `resolveLaunchTarget` with injected grants, remote reader and stat | Covers SSH and HTTPS remote forms and ambiguity |
| TC-04 | Unit                     | Vitest over `resolveLaunchInvocation` with injected dependencies               | Asserts no session start on any refusal         |
| TC-05 | Component                | Vitest with `ink-testing-library` over the composer and the notice             | Asserts the first frame and the escalation      |
| TC-06 | Unit                     | Vitest over the `startCli` pre-parse seam and the help output                  |                                                 |
| TC-07 | Unit                     | Vitest over `listGrants()` against a fixture trust store                       | Read-only and corrupt-store behavior            |
| TC-08 | Engineering verification | package build, test and typecheck; `pnpm harness:scan`; `pnpm lint`            |                                                 |
| TC-09 | Process / PTY            | Agent-controlled PTY over the built CLI in a temporary trusted repository      | The user execution scenario                     |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

Executability was proven before drafting (2026-09-20, `user-execution-scenario-author`) against the surface as it is TODAY, with none of this item's behaviour implemented. The workspace binary `packages/agent-cli/bin/robota.cjs` runs under `process.execPath` (`--version` → `robota 3.0.0-beta.79`, exit 0). In a throwaway repository under the session scratchpad with an isolated `HOME`, `robota trust --yes` printed `Workspace trust: trusted` and wrote a `"state": "trusted"` grant into `$HOME/.robota/workspace-trust.json`; in a sibling repository left ungranted, `robota trust status` printed `Workspace trust: untrusted` and `Grant access with: robota trust --yes` — the two states Scenario 1 and Scenario 3 start from, and the literal remedy string Scenario 3 expects. The current drift symptom was reproduced at the same surface: `robota open 'robota://open?v=1&prompt=hi&provider=evil' -p "/help" --bare --no-session-persistence` printed no unknown-command error and no link diagnostic at all — its output differed from the identical run without the two `open` tokens and ended in a provider call, i.e. the link is silently swallowed rather than refused, which is exactly what Scenario 2 replaces. The PTY harness that drives Scenario 1 was exercised as it stands: `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flag-tui.ptytest.ts` passed 2/2 in 0.9 s, rendering the built CLI in a real `xterm-256color` PTY. On a host where a global `robota` shadows the workspace one (`pnpm exec which robota` resolves to `~/.volta/bin/robota` here), a human runs `node <repo>/packages/agent-cli/bin/robota.cjs` with the same arguments; the ptytest always spawns the workspace binary by path.

### Scenario 1: a v=1 link opens the trusted fixture repository with the prompt prefilled, inert and labelled, and only Enter submits it

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after building its dependencies); `git` is on PATH; no live credential and no external service is required at any point in this scenario — every observable is a rendered frame or the process exit code, and none of them is a provider response. Two fixtures are created OUTSIDE the monorepo: `/tmp/flow2006-trusted` (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid`; `README.md` = `fixture`, committed as `chore: fixture`) and `/tmp/flow2006-elsewhere` (an unrelated empty directory the command is launched FROM, so the change of directory is observable). `HOME` is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`: `currentProvider: anthropic`, `apiKey: pty-dummy-key`); inside `/tmp/flow2006-trusted` run `robota trust --yes` once, which prints `Workspace trust: trusted` and records the grant under that HOME. The process runs in a 100x32 `xterm-256color` PTY driven by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts`), which spawns `packages/agent-cli/bin/robota.cjs` under `process.execPath`; a human runs the command below from `/tmp/flow2006-elsewhere`, reads the first frame WITHOUT typing anything, then presses Enter exactly once, then types `/exit` and Enter on `Exit the session?` (TC-09 prefill half).
- command: `robota open 'robota://open?v=1&prompt=Summarize%20the%20README%20in%20one%20sentence&cwd=/tmp/flow2006-trusted'`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=an ordinary interactive session starts whose working directory is the fixture repository `/tmp/flow2006-trusted` (or its realpath `/private/tmp/flow2006-trusted` on macOS) and NOT `/tmp/flow2006-elsewhere`; on the FIRST frame the composer already holds the decoded text `Summarize the README in one sentence` with the cursor after it, while the transcript holds no user message and no assistant activity and the status line reads `Idle` — the prompt is present and unsent; the line `Prompt from an external link` is rendered below the input and stays there while the value is unchanged; pressing Enter once sends exactly that text — it leaves the composer, appears as the submitted user message, and the external-link notice disappears; the proof that nothing reached a provider before Enter is the first frame itself — the transcript is empty and the status line reads `Idle` while the prompt sits in the composer — so no provider response is part of any observable here and the scenario neither needs nor contacts an external service; typing `/exit` and confirming exits the process with code 0.
- cleanup: exit with `/exit` (Yes) and confirm the process exited, then remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME (the trust grant lives under that HOME and goes with it); nothing under the monorepo is created, modified or trusted.
- evidence: 2026-09-20 — agent-executed in a real 100x30 `xterm-256color` PTY by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` Scenario 1 (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts` → 3 passed in 6.75 s). The frame that arrives with the prefill shows `> Summarize the README in one sentence` in the composer, `Prompt from an external link` on the line below it, and `Idle  |  flow2006  |  git: main` on the status line — the fixture repository's branch, i.e. the process is no longer in the launch directory — with neither `Thinking` nor `Interrupting` anywhere in the transcript; one Enter then re-emits exactly that text as the submitted message, and `git log --oneline` in the fixture still reports the single `chore: fixture` commit. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

### Scenario 2: every malformed or configuration-bearing link is refused on stderr with a non-zero exit and no session

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build, the same isolated HOME and the same trusted `/tmp/flow2006-trusted` fixture as Scenario 1 (so that only the link, never the target, is what each invocation is refused for); run from `/tmp/flow2006-elsewhere` in a plain non-PTY shell with `TERM=dumb` and no provider key in the environment, capturing stdout, stderr and the exit code of each of these nine invocations in order: the command below (unknown key `provider`); `robota open 'robota://open?v=1&prompt=a&prompt=b&cwd=/tmp/flow2006-trusted'` (duplicate key); `robota open 'robota://open?prompt=hi&cwd=/tmp/flow2006-trusted'` (missing `v`); `robota open 'robota://open?v=2&prompt=hi&cwd=/tmp/flow2006-trusted'` (wrong version); `robota open 'robota://open?v=1&prompt=%2Fmode%20bypassPermissions&cwd=/tmp/flow2006-trusted'` (a prompt that is a slash command); `robota open 'robota://open?v=1&prompt=hi&cwd=relative/path'` (relative `cwd`); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted/../etc'` (a `..` segment); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-missing'` (a directory that does not exist); and `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted' extra` (a second argument after the URL); afterwards inspect the session records and the permission mode under the isolated HOME and confirm no Robota process is left running (TC-09 refusal half).
- command: `robota open 'robota://open?v=1&prompt=hi&provider=anthropic&cwd=/tmp/flow2006-trusted'`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=provider — the refusal goes to STDERR and names the offending key `provider` rather than saying only that the link is invalid, stdout is empty, no TUI frame is drawn, the process exits 1 without waiting for input, and the whole URL is discarded so the prompt it carried is nowhere applied; each of the other eight invocations likewise exits non-zero with a single stderr line naming the FIRST rule it violated — the duplicate key `prompt`, the missing `v`, the unsupported version `2`, that a link may carry a prompt but not a command (for `%2Fmode%20bypassPermissions`), that `cwd` must be absolute, that `cwd` may not contain `..`, that the named directory does not exist, and that exactly one argument may follow `open` — and after all nine the isolated HOME holds no new session record, the recorded permission mode is unchanged (the `/mode bypassPermissions` link changed nothing), and no interactive session was ever started.
- cleanup: no process is left to exit (every invocation exits on its own); remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; nothing under the monorepo is touched.
- evidence: 2026-09-20 — agent-executed by Scenario 2 of the same ptytest, which runs the nine invocations headless (`TERM=dumb`) from the launch directory. Each exits 1 with the first violated rule named on stderr — `provider`, `more than once`, the missing `v`, `version 1`, `not a command`, `absolute`, the `..` segment, `does not exist` — and with no `Type a message` on stdout; the ninth, a second link appended to argv, exits 1 naming `exactly one link`. Afterwards the listing of `$HOME/.robota/peers` is identical to the one taken before the run (an interactive session writes an entry there, so none was started) and `$HOME/.robota/settings.json` is byte-identical, so the `/mode bypassPermissions` link changed nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

### Scenario 3: an untrusted directory and an unrecorded repository slug are both refused, naming robota trust --yes, and nothing is trusted, cloned or written

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and the same isolated HOME as Scenario 1, including the `robota trust --yes` grant for `/tmp/flow2006-trusted` (so the store is non-empty and the refusal is about THIS target, not an unreadable store); additionally create `/tmp/flow2006-untrusted` as a git repository with one commit exactly as the trusted fixture was created but WITHOUT ever running `robota trust --yes` in it — `robota trust status` there prints `Workspace trust: untrusted` and `Grant access with: robota trust --yes`, which is the starting state; record `shasum $HOME/.robota/workspace-trust.json` before the run; then from `/tmp/flow2006-elsewhere` with `TERM=dumb` run the command below and, second, `robota open 'robota://open?v=1&prompt=hi&repo=nobody/not-a-clone'`, capturing stdout, stderr and the exit code of each; afterwards re-run `robota trust status` inside `/tmp/flow2006-untrusted` and re-take the checksum (TC-09 untrusted half).
- command: `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-untrusted'`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=robota trust --yes — the refusal is written to STDERR, names the target path `/tmp/flow2006-untrusted` and the exact remedy `robota trust --yes`, stdout is empty, no TUI frame is drawn and no session starts; the second invocation, `repo=nobody/not-a-clone`, likewise exits non-zero with a stderr line naming the slug `nobody/not-a-clone` and offering the two ways forward (open the link with `cwd=`, or run `robota` in that clone and trust it first), and it neither clones nor fetches — no network is used and `/tmp/flow2006-untrusted` gains no `.git` remote; afterwards `robota trust status` inside `/tmp/flow2006-untrusted` still prints `Workspace trust: untrusted`, and `shasum $HOME/.robota/workspace-trust.json` is byte-identical to the value recorded before the run — a refused link grants nothing and records nothing.
- cleanup: no process is left to exit; remove `/tmp/flow2006-trusted`, `/tmp/flow2006-untrusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; no trust grant is left anywhere and nothing under the monorepo is touched.
- evidence: 2026-09-20 — agent-executed by Scenario 3 of the same ptytest: the untrusted-directory link exits 1 with `robota trust --yes` on stderr, and `repo=nobody/not-a-clone` exits 1 naming the slug with no mention of cloning. Afterwards `robota trust status` inside the untrusted fixture still prints `untrusted`, and the SHA-256 of `$HOME/.robota/workspace-trust.json` equals the digest taken before the two invocations — a refused link grants nothing and records nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

## Tasks

- [ ] `.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` — in-progress

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

**Ordering check.** GATE-WRITE is the entry gate (gate-catalogue.md § Prior-gate map: "GATE-WRITE has
no prior status gate"), so no prior-gate PASS is required. Input state matches: frontmatter
`status: draft`, `lane: L2`, document under `.agents/spec-docs/draft/`, `## Evidence Log` empty
before this entry.

**Mechanical set** — `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this doc> --dry-run`
re-run by this guardian on 2026-09-20: `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`.
No entry was written by `gate.mjs` (with pending criteria and no FAIL it writes none), so this entry
is the sole GATE-WRITE record. Section results it reported: frontmatter 4/4 PASS (`status: draft`,
`type: FLOW`, `tags:` 1 value); Problem no TBD/TODO (2861 chars, 17 sentences); Prior Art Research
present and substantiated per `scan-spec-research`; Architecture Review Checklist 5/5 `[x]`, Sibling
scan `[x]` with completion evidence, 4 numbered alternatives each with Pro and Con; Completion
Criteria 9 items all `TC-NN:` prefixed with none of the four banned phrases; Test Plan present with
**9 rows = 9 TC criteria (count confirmed)**, every row with a non-empty Test Type and Tool, 0 manual
rows; Tasks section present; Evidence Log present with 0 prior entries; no `## Status` /
`## Classification` body sections.

**Semantic set** — the seven criteria `gate.mjs` left PENDING-GUARDIAN, each judged against the
document and the live source:

- GATE-WRITE — Contains a concrete symptom: MET. § Problem names the exact invocation
  `robota open 'robota://open?v=1&prompt=hi'` and the wrong behaviour it produces — no unknown-command
  error, an ordinary interactive session in the current directory with both tokens silently
  discarded. Verified rather than accepted: `packages/agent-cli/src/utils/cli-args.ts:142` is
  `allowPositionals: true`, and `packages/agent-cli/src/startup/preparsed-command-routing.ts`
  branches only on `trust` (line 47), `usage` (51), `session analyze` (58) and `eval` (66) — each
  `return true` (terminate), and none is `open`. `git grep -l 'robota://' -- 'packages/*/src'
'apps/*/src'` returns zero files, as the section claims.
- GATE-WRITE — Contains a reproduction condition: MET. The when/where is stated as the invocation
  above from any directory with the shipped `robota` bin, i.e. on every unrecognised positional, not
  a rare state; and the second half (no rule constrains what a link may carry) is grounded in the
  absence of any `robota://` reader in the tree. The two Robota-specific preconditions are also
  checked: `packages/agent-cli` ships as a `bin` with no app bundle, and the trust admission gate at
  `packages/agent-cli/src/cli.ts:133` is guarded by
  `(args.printMode || args.goal !== undefined || args.serve)`, i.e. headless-only, exactly as written.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: MET, and traceable
  line by line rather than asserted. The 5,000-code-point prompt cap is adopted from the Claude Code
  deep-link documentation rather than invented; the invisible/bidirectional refusal class is the
  class that documentation names for paths; "reject, do not fall back" is decided against the one
  recorded conflict in the table (Slack falls back to `slack://open`, Claude Code accepts one path);
  unknown-key rejection rests on OWASP MASWE-0029's discard-the-whole-URL; the exactly-one-argument
  rule rests on the Microsoft URI-handler security warning plus Electron's documented unstable
  `second-instance` argv; prefill-never-submit is the behaviour four surveyed products converge on;
  and the provider-neutrality finding (no surveyed parameter names a model, provider, endpoint or
  credential) is what produces the closed four-key allowlist. Alternative 1's Con is built from the
  registration evidence base (Apple `CFBundleURLTypes`, freedesktop `%u`, the Windows registry,
  Electron `open-url`), and Alternative 4's Con from the unsigned-artifact fact recorded in
  `apps/agent-app`'s own `electron-builder.yml`.
- GATE-WRITE — Decision references the trade-off that drove the choice: MET. § Decision selects
  Alternative 2 and names the trade-off it accepts — the link is not clickable from a browser until
  FLOW-2670 registers the scheme, bought for a fully unit-testable, OS-state-free contract that
  lands BEFORE any handler exists so a later registration PR inherits the strict parser rather than
  shipping a looser one. A second placement trade-off is stated explicitly in § "Where the grammar
  lives, decided rather than defaulted": the parser is kept at `packages/agent-cli/src/launch-intent/`
  rather than a zero-dependency leaf package because it has exactly one consumer today, with the
  extraction named as a required step of the follow-on rather than left to be discovered.
- GATE-WRITE — New-surface placement (conditional): MET as **N/A**, with the substance discharged
  anyway. N/A is accurate: no new package and no new app — § Affected Files introduces one new
  directory inside the package that already owns CLI startup, one new component file in
  `packages/agent-ui-terminal`, and two optional fields on the existing `IRenderOptions`
  (`showSessionPickerOnStart` at `packages/agent-ui-terminal/src/render.tsx:101` is the existing
  threading path the spec mirrors). `listGrants()` widens the existing `IWorkspaceTrustStore`
  (`packages/agent-framework/src/workspace-trust/types.ts:42-48` has `inspect`/`grant`/`revoke` and
  no list capability, as the spec states) rather than creating a surface. Even read against the
  rule's wider trigger ("a new module that could plausibly live in more than one place"), both
  required showings are present: (a) the analogous existing layers are named in the Sibling scan —
  `preparsed-command-routing.ts`, `workspace-trust-admission.ts`, `git-process.ts`,
  `render.tsx`'s `IRenderOptions` — with the classification argued (the parser belongs to the CLI
  product, not to `apps/agent-app`, which Alternative 4 rejects on product-surface grounds); and
  (b) reuse is at the contract level — `createGitProcess` / `IGitProcessPort` is consumed from
  `@robota-sdk/agent-command` (exported at `packages/agent-command/src/index.ts:20,26`; the
  dependency is already declared at `packages/agent-cli/package.json:109`), and the grant read is
  defined beside the store instead of a second parser over `workspace-trust.json` from `agent-cli`.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: MET. Every Solution step maps
  to a criterion: step 1 → TC-01/TC-02, step 2 → TC-07, step 3 → TC-03, step 4 → TC-04, step 5 →
  TC-06 (with TC-04 asserting the `open <url>` tokens are removed from the argv handed onward),
  step 6 → TC-05, step 7 → TC-05, step 9 → bookkeeping, not a feature. Step 8 (docs) is covered
  mechanically rather than by a prose criterion: TC-06 asserts `--help` lists `open <url>`, and
  TC-08's `pnpm harness:scan` includes `harness:scan:spec-public-surface`
  (`scripts/harness/check-spec-public-surface.mjs`), which is what holds the `listGrants` SPEC entry.
  TC-09 covers the end-to-end user-execution scenario. The containment obligation is a criterion,
  not a promise: TC-03 requires the literal `Contained — TRUST-1989.` at the refusal site in
  `resolve-launch-target.ts` and in the commit body — both halves `finding-depth.md` demands — and
  the root item it points at exists.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: MET. All nine are in
  observable-behaviour or command form with named inputs and named outcomes (e.g. TC-01 enumerates
  the accepted and refused inputs and requires each refusal to name the violated rule; TC-08 is
  command form, "build, test and typecheck … exit 0", `pnpm harness:scan` exits 0). A scan of the
  section for vague terms beyond the four banned phrases (`properly`, `correctly`, `as expected`,
  `appropriate`, `gracefully`, `etc.`) returns zero hits.

**Cited records verified (existence and content, not just citation).** All three exist under
`.agents/tasks/` and say what this spec claims:
`TRUST-1989-decide-workspace-trust-at-interactive-startup.md` (records the headless-only guard
verbatim and states that FLOW-2006 contains against it rather than patching it),
`CLI-2670-refuse-unknown-cli-positionals.md` (owns the silent unknown-positional defect), and
`FLOW-2670-register-the-robota-url-scheme-on-desktop-platforms.md` (`depends_on: [FLOW-2006]`, and
its TC-01 is the grammar extraction this spec promises as a required step of the follow-on). The
review record in § Decision was checked against the ledger: run `r20260920080837` in
`.agents/loop-runs/backlog-execution-orchestrator.jsonl` is `"roundFindings":[10,11,0]`,
`"terminal":"converged"`. The `/mode bypassPermissions` threat the prefill rule is built on is real:
`packages/agent-command/src/mode/mode-command-module.ts` registers `mode`, and
`packages/agent-ui-terminal/src/TuiInteractionChannel.ts:360` is the `startsWith('/')` branch.
`packages/agent-ui-terminal/src/InputArea.tsx:92` is `const [value, setValue] = useState('');` and
`packages/agent-cli/src/cli.ts:80` is `const cwd = process.cwd();`, both as cited.

**Judged by:** `backlog-gate-guard` (semantic criteria) over `gate.mjs` mechanical evaluator output
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/draft/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `7f717fe2eba8` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "스펙 승인, 구현 진행"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** de0171188ab5 (review 066b66f7, type/tags 2c2b90c0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (de0171188ab5) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `74cc69582bf4` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "스펙 승인, 구현 진행"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** de0171188ab5 (review 066b66f7, type/tags 2c2b90c0)

**Ordering check.** PASS. Prior gate per gate-catalogue.md § Prior-gate map is GATE-WRITE, re-run rule
`recorded-pass`: the Evidence Log carries `### [GATE-WRITE] — ✅ PASS | 2026-09-20` whose
`**Status upgrade:** draft → review-ready` names the document's CURRENT `status: review-ready`, and it
is the only GATE-WRITE entry. Expected input state matches: frontmatter `status: review-ready`,
`lane: L2`, and the file sits in `.agents/spec-docs/backlog/`, which spec-workflow.md
§ Spec-Document Status and Lifecycle Folders maps `review-ready` to.

**Mechanical set** — `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this doc> --dry-run`
re-run by this guardian from the repository root on 2026-09-20: `9 criteria judged — 6 PASS, 0 FAIL,
3 PENDING-GUARDIAN`, exit 0, no entry written (`gate-cli.mjs:51` — with pending criteria the script
writes none). The preceding `✅ PASS` entry in this log is the record `gate.mjs approve` wrote, which
carries the approval fields and the mechanical set only; this entry is the guardian verdict that
resolves the three semantic criteria it left open.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS (mechanical,
  re-confirmed) — route DIRECT, `**Instruction (verbatim):**` recorded, given 2026-09-20, this
  conversation.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS.
  Verified in this session's own transcript rather than taken from the dispatch: the `AskUserQuestion`
  call `toolu_01JBnSRSSyMdZxpJp12GPmi8` asked `"FLOW-2006 스펙(딥링크 실행 인텐트)이 GATE-WRITE를
통과하고 독립 리뷰 3라운드 끝에 ENDORSE를 받았습니다. 구현에 들어가도 될까요?"` and summarised the
  contract; the recorded answer at `2026-09-20T08:35:43.247Z` is
  `"스펙 승인, 구현 진행 (권장)"`. It names this item by ID, confirms the design and authorizes
  implementation, and it is not a clarifying answer, a silence, or the approval of another item: the
  two alternatives offered were a narrower `cwd=`-only scope (dropping `listGrants()` and the
  `agent-framework` change) and pausing to move to SCREEN-2442, and the approval option was chosen
  over both. The question's summary was checked line by line against § Decision and matches it —
  `v` required, the closed four-key allowlist `v`/`prompt`/`cwd`/`repo`, unknown and duplicate keys
  and the 8,192-code-point cap and a second argument all refused by discarding the whole URL to
  stderr with a non-zero exit, prefill-never-submit, a `/`-leading prompt refused at the parser,
  targets restricted to already-`trusted` directories, and OS registration carved out as FLOW-2670
  (the record exists at `.agents/tasks/FLOW-2670-register-the-robota-url-scheme-on-desktop-platforms.md`).
  One divergence is recorded rather than smoothed over: the selected option label ends `" (권장)"`
  (the assistant's own Recommended marker) and the instruction was recorded without it. The user text
  is otherwise identical and the dropped token is not the user's, so the approval's direction, target
  and scope are unchanged.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry
  predates this approval: N/A — route DIRECT, no class is cited, so there is no registry row to date.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it
  was given in: PASS as the Route CLASS criterion is N/A (route DIRECT); the DIRECT provenance is
  recorded above and corroborated by the transcript timestamp.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by
  assertion: N/A — route DIRECT invokes no class and therefore no evidence condition.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT. No
  delegated class is claimed, so no class boundary is argued or crossed; the authority is the
  instruction given for this document, not a resemblance to a registered category.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS —
  the `**Review fingerprint:**` recorded at approval (de0171188ab5, review 066b66f7, type/tags
  2c2b90c0) equals the document's current fingerprint, re-measured by the judge run above.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A, and the reading is stated
  plainly because the dispatch asked for it. The trigger in spec-workflow.md § New-Surface
  Architecture Placement is a new package, app or presentation/interface surface, or a layer /
  product-family reclassification. None is present: § Affected Files adds one directory
  (`packages/agent-cli/src/launch-intent/`) inside the package that already owns CLI startup, one
  component file in `packages/agent-ui-terminal`, and two optional fields on the existing
  `IRenderOptions`. **Widening `IWorkspaceTrustStore` with `listGrants()` is not a new surface for
  this criterion**: it adds a read method to an existing contract in `agent-framework`, the package
  that already owns the store and the file it reads, so there is no placement question to validate —
  the owner, the layer and the product family are all unchanged, and the anti-pattern the rule
  targets (a new thing built as a skin on a sibling product instead of on the shared core) is the
  opposite of what is proposed. It is a genuine security widening, which the spec treats as one
  (read-only, the store's own validated shape, one production consumer), but that is a design risk,
  not a placement reclassification, and this criterion asks only about placement. The one item that
  could be read into the wider clause — the launch-intent grammar as "a new module that could
  plausibly live in more than one place" — is discharged anyway rather than left to the reading: the
  independent `proposal-reviewer` round-3 verdict for this document (subagent
  `agent-a395298d3370130cc`, `2026-09-20T08:29:12Z`) states "Placement `N/A` remains the correct
  verdict: no new package, app or interface surface" and covers the two placement decisions
  explicitly — the capability defined beside the store rather than re-parsed downstream, and the
  grammar kept CLI-local with its extraction named as a required step of FLOW-2670 — ending
  `REVIEW VERDICT: ENDORSE`, `DEPTH: LOCAL`. The three-round ledger the spec cites was verified:
  `.agents/loop-runs/backlog-execution-orchestrator.jsonl` line 61, run `r20260920080837`,
  `"roundFindings":[10,11,0]`, `"terminal":"converged"`. No `architecture-audit-fanout`
  structure-channel result is required, since that clause applies only "when the surface is new" and
  it is not.

**NON-COMPLIANCE trigger checked, not assumed.** No implementation work preceded this gate:
`packages/agent-cli/src/launch-intent/` does not exist, `git grep -n listGrants -- packages` returns
nothing, and `git status --porcelain` shows only this untracked spec, the three untracked Task
records it cites, and the orchestrator ledger — no `.ts` change on this branch.

**Judged by:** `backlog-gate-guard` (semantic criteria) over `gate.mjs` mechanical evaluator output
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `f56abd3d3c17` (untracked)

### [GATE-IMPLEMENT] — 🔴 WITHDRAWN | 2026-09-20

**Status returned:** in-progress → approved (the `todo/` → `active/` move is reversed with it)

This gate was judged and its transition taken while `DONE-GATE-STAGE-1` was still being judged
concurrently. That inverts the order the catalogue fixes: GATE-IMPLEMENT's own criterion "the exact
Task records a subject-bound user-execution PLAN terminal outcome" requires, for an applicable
outcome, the author verdict AND a `DONE-GATE-STAGE-1` PASS — and the Task carried no such entry, so
the criterion was satisfied on its author-verdict half alone. `backlog-gate-guard` refused
`DONE-GATE-STAGE-1` with `GATE VERDICT: NON-COMPLIANCE` (recorded in the Task) and named the remedy:
withdraw this PASS and the transition, run Stage 1 against the `approved` document, then re-run
GATE-IMPLEMENT against a Task that carries the Stage-1 PASS. That is what this entry records. No
implementation existed when the inversion happened and none was written under it; the withdrawal is
therefore complete rather than partial.

**Withdrawn by:** the orchestrator, on `backlog-gate-guard`'s stated required action
**Judged by:** `backlog-gate-guard` (the NON-COMPLIANCE that required the withdrawal) over `gate.mjs` mechanical evaluator output

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (9)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 205 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 3`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md",
  "specPath": ".agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 3
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md",
    ".agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `673cce114bc2` (untracked)

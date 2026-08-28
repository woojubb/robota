---
status: approved
type: SECURITY
lane: L2
tags: [agent-core, permissions, security]
---

# CORE-049: permission patterns match by argument kind

## Problem

`packages/agent-core/src/permissions/permission-gate.ts` matches an argument-scoped permission
pattern with one function for every argument kind:

```ts
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.+')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
// matchesPattern (:176-195): globToRegex(parsed.argPattern).test(primary)
```

`*` becomes `.*` and `**` becomes `.+`; nothing excludes `/`, `?`, `#`, `@` or `:`; the result is
anchored against the tool's primary argument as a raw string. For a URL that is a wildcard over the
whole URL, not over hostnames.

**Measured, 2026-08-29, `origin/develop` `dd46c9183`**, the shipped function copied verbatim:

```
pattern: https://*.example.com/**
MATCH   https://sub.example.com/ok                      ← intended
MATCH   https://evil.tld/?a=.example.com/x              ← query carries the match
MATCH   https://evil.tld/#.example.com/x                ← fragment carries the match
MATCH   https://169.254.169.254/?x=.example.com/y       ← cloud metadata endpoint
MATCH   https://evil.tld/.example.com/x                 ← path carries the match
```

An operator who writes `WebFetch(https://*.corp.example.com/**)` — the natural way to stop being
prompted for an internal host — has auto-approved every host an attacker can name, including the
link-local metadata service, because the matched text can live in a part of the URL the server
never sees as a host. The same shape holds for paths: `Read(/src/*)` matches `/src/a/b/c`, since
`*` crosses `/`. The tool profiles (`packages/agent-tools/src/tool-permission-profiles.ts`,
`packages/agent-framework/src/tools/tool-permission-profiles.ts`) declare `argumentKey` and
`riskClass` only — the gate has no way to know what kind of thing it is matching.

**Reproduction condition.** Any wildcard pattern evaluated against an argument whose delimiters the
wildcard may cross: every `WebFetch(scheme://…)` pattern; every path pattern with `*`.

## Prior Art Research

Two references shape the decision, from product documentation rather than source:

- **Claude Code permission rules** (<https://code.claude.com/docs/en/permissions>, "Tool-specific
  permission rules"): `WebFetch(domain:example.com)` scopes by domain, not by URL string;
  `Read(/src/**)`/`Edit(…)` use gitignore-style globs where `*` does not cross `/` and `**` does;
  `Bash(npm run *)` is a prefix match on the command; a bare `Tool` or `Tool(*)` means any
  invocation. Three argument kinds, three matchers, and a bare-wildcard rule above them — the shape
  this item adopts.
- **WHATWG URL Standard** (<https://url.spec.whatwg.org/>, § Host parsing; `new URL` implements it):
  for the SPECIAL schemes (`http`, `https`, `ws`, `wss`, `ftp`, `file`) parsing canonicalises hosts
  (`0x7f.1`, `2130706433`, `127.1`, `①②⑦.0.0.1` → `127.0.0.1`; `EXAMPLE.com` → `example.com`;
  `[0:0:0:0:0:0:0:1]` → `[::1]`) and separates userinfo, port, path, query and fragment. Measured in
  Node 22: a trailing dot is NOT canonicalised (`example.com.` stays); a NON-special scheme keeps its
  host opaque (`foo://0x7f.1/` stays `0x7f.1`, `foo://EXAMPLE.com` stays upper-case); `*://x/` and a
  bare `*` throw; `https://x` and `https://x/` both parse to `pathname: '/'`; a pathname keeps its
  percent-encoding (`/%61dmin/x`), only dot-segments are normalised. So the PATTERN side cannot be
  handed to `new URL` whole — it is split by a grammar first — and the argument side is parsed and
  then compared with the rules § Decision states.

Constraint that applies: the matcher is one boolean consumed by both the allow and the deny list
(`matchesAnyPattern`, `evaluatePermission` `:214`/`:231`, CORE-025's `resolvePermissionByPolicy`),
so "I could not interpret this" must not be reported as "no match" — on a deny that is fail-open,
and `WebFetch`/`Read` are `inspect`, which `RISK_CLASS_POLICY` resolves to `auto` in every mode
(`permission-mode.ts:57-78`). CORE-030 already owns that third state
(`hasUnevaluableArgumentPattern`: "I cannot tell" is not "no"), with an `_args` parameter it does not
yet read. `WebFetch` itself only does `new URL(url)` (`web-fetch-tool.ts:145`), so `file:`,
`foo://…` and `javascript:` arguments all reach the gate.

## User Execution Test Scenarios

Applicable — `SCENARIO DRAFTED: automatable | 3` (recorded in the paired Task by
`user-execution-scenario-author`, which overrode the orchestrator's not-applicable draft). The gate's
verdict is observable through the shipped `robota` binary in `-p` print mode with the INFRA-018
`--session-log` replay provider and a local `node:http` server: Scenario 1 — a deny on
`http://127.0.0.1:<port>/**` does not stop `http://127.1:<port>/…` today (shorthand IP; the request
reaches the server); Scenario 2 — `Write($S/ws/out/*)` auto-approves `out/deep/file.txt` today (`*`
crosses `/`); Scenario 3 — a deny on `http://*.example.com/**` over-matches
`http://127.0.0.1:<port>/?a=.example.com/x` today. Each inverts after the fix. The scenarios, in the
canonical field form, are in the Task; their DONE-GATE-STAGE-1 verdict is recorded there before
implementation. A print-mode observation the author made in passing is issue #2430.

## Depth verdict

Root. One function serving paths, URLs and commands is the cause; the egress boundary of
issue #2026 declares `depends_on` this item because its allowlist is only tolerable once a host
pattern means a host. The change is in the foundation package (`agent-core`) and in the profiles
the tool packages contribute. Signatures of `matchesAnyPattern` and `hasUnevaluableArgumentPattern`
do not change; the SEMANTICS of the second do — it gains the unevaluable conditions below — and both
of its consumers (`evaluatePermission`, `resolvePermissionByPolicy`) already route that state.
Neighbouring roots are filed, not folded: loud refusal of a malformed pattern at config/preset load
(issue #2428); resolving a relative `Read`/`Write`/`Edit` argument against the tool `cwd` before the
gate sees it (issue #2429); the command-separator residual (issue #2427); the print-mode hook
observation (issue #2430).

## Architecture Review

### Affected Scope

- `packages/agent-core/src/permissions/permission-gate.ts` — the argument declaration becomes one
  object, `argument?: IToolPermissionArgument` with `{ key: string; kind: TArgumentKind }`, so a key
  cannot be declared without its kind (an `interface`, per code-quality.md, not a union alias);
  `matchesPattern` becomes tri-state (`match` / `no-match` / `unevaluable`) and dispatches by kind
  after the bare-wildcard rule; `hasUnevaluableArgumentPattern` reads its `_args` and reports every
  unevaluable condition; the `url` and `path` matchers are added; the glob stays for
  `command`/`text`.
- `packages/agent-tools/src/tool-permission-profiles.ts` and
  `packages/agent-framework/src/tools/tool-permission-profiles.ts` — the shipped tools declare
  `argument: { key, kind }` (`Read`/`Write`/`Edit` → `path`; `WebFetch` → `url`; `Bash`/`Shell`/
  `ExecuteCommand`/`BackgroundProcess` → `command`; `Glob`/`Grep`/`WebSearch` → `text`); the
  framework file's stale header comment (it claims a profile test exists) is corrected.
- Test registrations that declare a key (25 lines across five files in `agent-core` and
  `agent-session`) move to the object form — mechanical, except `unknown-tool-deny.test.ts`'s
  `MyTool` registrations, which pair a relative pattern with a relative argument and must be declared
  `text` (a `path` declaration would make them unevaluable, which those tests do not assert).
- `packages/agent-core/src/permissions/__tests__/permission-gate.test.ts` and the two profile test
  files — the matcher, tri-state and shipped-declaration cases; `agent-tools`'s profile test reads
  `profile.argument?.key`.
- `packages/agent-core/docs/SPEC.md` § Permission Argument Registry Public API and § Evaluation
  Algorithm — `IToolPermissionArgument`, the per-kind grammar and semantics, every unevaluable
  condition enumerated (contract sections; lane L2).

### Alternatives Considered

1. **A1 — a matcher per argument kind, declared with the key, tri-state (chosen).** The profile that
   says WHICH argument a pattern is about also says WHAT KIND it is, in one object. Matching runs in
   this order: (i) a bare `*` or `**` argument pattern matches any invocation of the tool, for every
   kind and even for a tool that declared no argument — the contract `toolNamesToPatterns` (preset
   `allowedTools` / `deniedTools` → `Tool(*)`) and the documented syntax rely on; (ii) a tool with no
   declared argument → unevaluable (CORE-030, unchanged); (iii) the kind's matcher.
   **`url`.** The PATTERN is split by the grammar `scheme://host[:port][/path]` — scheme a literal
   or `*`; host either a bracketed IPv6 literal `[hex:.]` or labels with `*`/`**` and no `@`, `:`,
   `/`, `?`, `#`; port a number or `*`; path optional — a pattern with userinfo, query or fragment
   does not fit and is unevaluable. The ARGUMENT is parsed with `new URL`. Rules: the argument's
   scheme must be SPECIAL (`http`, `https`, `ws`, `wss`, `ftp`) — a non-special scheme keeps its host
   opaque, so it is unevaluable; `file:` and any host-less argument are unevaluable; an argument with
   `username`/`password` is unevaluable; scheme compared exact or `*`. Host: both sides drop one
   trailing dot and lower-case; a LITERAL pattern host is canonicalised by parsing `http://<host>/`
   (a special scheme, shared by every pattern scheme including `*`) — one that still throws is
   unevaluable — and compared for equality with `url.hostname` (brackets included for IPv6); a
   WILDCARD pattern host is compared label-wise after its literal labels pass `domainToASCII` (a
   label that maps to the empty string is unevaluable): `*` as
   a whole label = one or more labels, `**` as a whole label = zero or more labels (so
   `**.example.com` covers the apex), `*` inside a label = within that label, `*` as the entire host
   = any host, `a**b` inside a label = unevaluable. Port: equal to the pattern's, or the scheme
   default when the pattern names none (`*` = any). Path: absent in the pattern = any path; else
   compared segment-wise on PERCENT-DECODED segments (`decodeURIComponent` per segment; a segment that
   fails to decode is unevaluable; a decoded `/` inside a segment can never equal a pattern segment,
   so `%2F` is safe), `*` within a segment, `**` across, `/**` matches `/`. `search` and `hash` never
   participate.
   **`path`.** Separators normalised (`\` → `/`), then `path.posix.normalize` on both sides (`.`/`..`
   collapsed, no filesystem access); absolute means `/…` or a drive prefix `X:/…`; a relative argument
   under an absolute pattern is unevaluable (issue #2429 owns resolving it); `*` → `[^/]*`, `**` →
   `.*`, anchored.
   **`command` and `text`.** Today's glob, unchanged.
   Unevaluable is reported through `hasUnevaluableArgumentPattern`, so a deny that cannot be evaluated
   prompts (`approve`) in `default`/`acceptEdits`, denies in `plan`, and denies in the policy resolver —
   never falls through to `auto`. Pro: each kind's delimiter and canonical form live in one matcher;
   the URL verdict comes from parsing; the shipped tools and every registrant are covered by the
   object's shape, not by a documented default; "could not check" stays distinguishable from "fine".
   Con: ~27 declaration sites move to the object form (mechanical); the URL grammar is new code that
   must be pinned by tests, including the IPv6, `@`, non-special-scheme and percent-encoding cases.
2. **A2 — infer the kind from the pattern's shape (`scheme://` → url, leading `/` → path).** Pro: no
   profile change. Con (rejected): a pattern's shape is the operator's spelling, not the argument's
   kind — `Bash(https://*)` is a command pattern, `Read(https://…)` a path one; a relative path
   pattern has no leading `/`. The profile is the owner of "what argument this is".
3. **A3 — keep one glob and escape more characters (`*` → `[^/?#@:]*`).** Pro: smallest diff. Con
   (rejected): it keeps the shape that caused the defect — the URL is still an opaque string, so
   `SUB.example.com`, `0x7f.1`, `127.1` and `2130706433` are wrong in both directions; the issue's
   acceptance names this as the anti-goal.
4. **A4 — reclassify `WebFetch` so no allow pattern can auto-approve it.** Pro: closes the exposure
   for that tool. Con (rejected): it does nothing for `Read`/`Write` paths or for the deny side, and
   it removes the escape hatch the egress design (issue #2026) needs; that design depends on this
   fix, not the reverse.
5. **A5 — A1 without the third state (uninterpretable = no match).** Pro: one boolean, no change to
   `hasUnevaluableArgumentPattern`. Con (rejected): on the deny list a non-match is "not denied", and
   `inspect` resolves to `auto` in every mode — a userinfo URL, an unparseable argument, a
   non-special scheme or a mistyped pattern would silently pass the exact deny written to stop it.
   That is CORE-030's defect one level down.
6. **A6 — A1 with the kind as a sibling field coupled by a union (`{ argumentKey; argumentKind } |
{}`).** Pro: keeps the field names. Con (rejected): it turns the exported `I*` interface into a
   union alias of object shapes, which code-quality.md forbids; one
   object `{ key, kind }` expresses "both or neither" by construction.

### Decision

A1. The argument declaration is one object — `argument: { key, kind }` — in the profile the tool's
package already contributes (CORE-030's principle: the package that defines the tool says how it is
judged). Bare `*`/`**` means any invocation before any kind — or key — is consulted, which changes
one existing verdict: `deniedTools: ['CodebaseRetrieval']` (a keyless tool) is `deny` now, where
today the `(*)` pattern is unevaluable and prompts; that is the `toolNamesToPatterns` contract, stated
and pinned. The `url` matcher splits the pattern by grammar, parses the argument, and compares scheme,
host, port and path structurally under the rules A1 states; query and fragment are ignored;
userinfo, an unparseable argument, a host-less or non-special scheme, a pattern the grammar rejects, a
literal pattern host that does not parse, and an undecodable path segment are **unevaluable**, not
non-matches. The `path` matcher normalises separators and segments, keeps `*` inside a segment, and
treats a relative argument as unevaluable; on Windows a drive-prefixed argument is absolute, so the
platform is covered rather than silently unevaluable. `command`/`text` keep today's semantics — the
separator residual is issue #2427. The trade-off taken: a third state costs every consumer nothing
(both already route it) and costs the operator a prompt where a silent pass used to be; the
alternative (A5) is the fail-open shape this item exists to remove. The anti-goal is stated by the
tests: the canonicalisation cases can only pass through parsing, and the deny-direction cases can
only pass through the third state.

**Fail direction of every refusal path.** Allow list: unevaluable → not auto → the mode policy
(today `auto` for `inspect` — the allow side changes nothing until issue #2026 reclassifies
`WebFetch`, which is why the deny side is where this is judged). Deny list: unevaluable → `approve`
(a prompt) in `default`/`acceptEdits`, `deny` in `plan`, `deny` in `resolvePermissionByPolicy`.

**Landing path.** One PR: the foundation change, the object declaration, the two profile files and
the test registrations land together — the type makes a half-landing a compile error. Lane L2.
Implementation note: `scan-tool-classification.mjs`'s `PROFILE_KEY_RE` counts a line-leading
`argument: {` as a tool name, so the argument object stays on the tool's line.

### Architecture Review Checklist

- [x] Affected package/layer list complete — `agent-core` (gate, tests, SPEC), the two profile
      files and profile tests in `agent-tools` and `agent-framework`, the test registrations in
      `agent-core` and `agent-session`
- [x] Sibling scan complete — `N/A for new-surface placement`: no new package, app, presentation or
      interface surface; `IToolPermissionArgument` is a nested interface on the existing exported
      profile. Consumers of the matcher: `evaluatePermission` and `resolvePermissionByPolicy`
      (CORE-025) keep calling the same two exports and already route the unevaluable state;
      `permission-enforcer.ts:167-193` (agent-session) calls only those two.
- [x] At least 2 alternatives reviewed — A1–A6
- [x] Decision rationale documented — the kind is the profile's to declare, in one object; parsing,
      not escaping; a third state, not a boolean, because a deny must never fail open

## Fallback & Degradation Declaration

None that is silent. An uninterpretable pattern or argument under a `url` or `path` pattern is
**unevaluable**: on the allow list it is not `auto`; on the deny list it prompts in
`default`/`acceptEdits`, denies in `plan`, and denies in the policy resolver. A profile that
declares a key without a kind does not type-check. Loud refusal of a malformed pattern at load time is
issue #2428.

## Solution

1. `TArgumentKind = 'path' | 'url' | 'command' | 'text'`; `interface IToolPermissionArgument { key:
string; kind: TArgumentKind }`; `IToolPermissionProfile { argument?: IToolPermissionArgument;
riskClass?: TToolRiskClass }` (the interface stays an interface); JSDoc enumerates every
   unevaluable condition; the `IToolPermissionProfile` JSDoc and SPEC step 2 list them all.
2. `matchesPattern` → `evaluateArgumentPattern(toolName, args, pattern): 'match' | 'no-match' |
'unevaluable'`: tool name mismatch → no-match; no argument pattern, or bare `*`/`**` → match;
   no declared argument → unevaluable; argument absent → no-match (CORE-030's reading); then the
   kind's matcher. `matchesAnyPattern` = some `match`; `hasUnevaluableArgumentPattern` = some
   `unevaluable` (reading `args`).
3. `matchUrl(pattern, arg)`: the grammar as a string, then a `RegExp` —
   `^(\*|[a-z][a-z0-9+.-]*):\/\/(\[[0-9a-fA-F:.]+\]|[^/:?#@\[\]]+)(?::(\d+|\*))?(\/[^?#]*)?$` (case-insensitive);
   the argument via `new URL`; the rules of A1 (special scheme only; userinfo, host-less, literal-host
   parse failure, `a**b`, a label `domainToASCII` maps to `''`, undecodable segment → unevaluable; `domainToASCII` on wildcard-pattern
   labels; percent-decoded segment comparison).
4. `matchPath(pattern, arg)`: `\` → `/`; `path.posix.normalize` both; absolute = `/…` or `X:/…`;
   relative argument under an absolute pattern → unevaluable; `*` → `[^/]*`, `**` → `.*`, anchored.
5. The two profile files declare `argument: { key, kind }` for every shipped tool (object on the
   tool's line); every test registration moves to the object form, `MyTool` in
   `unknown-tool-deny.test.ts` as `text`; the framework profile file's stale header comment corrected.
6. Tests: placement, canonicalisation (anti-goal), deny-direction (userinfo, unparseable, host-less,
   non-special scheme, rejected pattern incl. `@`, undecodable segment) in all modes and in the policy
   resolver, IPv6 literal deny, percent-encoded path under a deny, path `..`/relative/Windows cases,
   bare-wildcard through the REAL `agent-tools` profiles and through a keyless tool, shipped
   declarations asserted per package, the `@ts-expect-error` key-without-kind registration;
   `packages/agent-core/docs/SPEC.md` updated.

## Affected Files

| File                                                                            | Change                                                                                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/permissions/permission-gate.ts`                        | `IToolPermissionArgument`; tri-state matcher; `matchUrl`, `matchPath`; CORE-030 seam                                              |
| `packages/agent-core/src/permissions/__tests__/permission-gate.test.ts`         | matcher, anti-goal, deny-direction, tri-state, IPv6, percent-encoding, Windows cases                                              |
| `packages/agent-core/src/permissions/__tests__/*.test.ts` (other registrations) | object form; `MyTool` declared `text`                                                                                             |
| `packages/agent-session/src/__tests__/selfhost-009*.test.ts`                    | object form                                                                                                                       |
| `packages/agent-tools/src/tool-permission-profiles.ts`                          | `argument: { key, kind }` for the shipped tools                                                                                   |
| `packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts`           | shipped kinds asserted; `Tool(*)` through the real profiles; `profile.argument?.key`                                              |
| `packages/agent-framework/src/tools/tool-permission-profiles.ts`                | object form for `BackgroundProcess`, `ExecuteCommand`; stale header comment corrected                                             |
| `packages/agent-framework/src/tools/__tests__/tool-permission-profiles.test.ts` | new — the framework's kinds asserted                                                                                              |
| `packages/agent-core/docs/SPEC.md`                                              | `IToolPermissionArgument`, per-kind grammar, every unevaluable condition, the keyless `Tool(*)` verdict, in the contract sections |

## Completion Criteria

- [ ] TC-01: URL placements: with `allow: ['WebFetch(https://*.example.com/**)']` on a `url`-kind
      profile, `evaluatePermission('WebFetch', { url }, 'default', …)` returns `auto` for
      `https://sub.example.com/ok`, `https://a.b.example.com/x` and `https://sub.example.com:443/x`,
      and the matcher (`matchesAnyPattern`) is `false` for `https://evil.tld/?a=.example.com/x`,
      `https://evil.tld/#.example.com/x`, `https://evil.tld/.example.com/x`,
      `https://169.254.169.254/?x=.example.com/y`, `https://sub.example.com:8443/` and
      `https://example.com/` (the apex is not under `*.`; `**.example.com` would cover it). Red
      before the fix.
- [ ] TC-02: Canonicalisation (the anti-goal): with `deny: ['WebFetch(http://127.0.0.1/**)']`,
      `http://0x7f.1/`, `http://2130706433/`, `http://127.1/`, `http://127.0.0.1:80/` and
      `http://127.0.0.1./` return `deny`; with `deny: ['WebFetch(http://[::1]/**)']`,
      `http://[0:0:0:0:0:0:0:1]/` returns `deny`; with `allow: ['WebFetch(https://sub.example.com/**)']`,
      `https://SUB.EXAMPLE.COM/x` and `https://sub.example.com./x` (a domain trailing dot, which the
      parser keeps) return `auto`; with `deny: ['WebFetch(https://h/admin/**)']`,
      `https://h/%61dmin/x` returns `deny`. These verdicts are only reachable through parsing.
- [ ] TC-03: Deny direction (the third state): with `deny: ['WebFetch(https://*.example.com/**)']`,
      each of `https://sub.example.com@evil.tld/`, `not a url`, `file:///etc/passwd`,
      `foo://0x7f.1/` (non-special scheme) and `https://sub.example.com/%E0%A4%A/x` (undecodable
      segment) returns `approve` in `default` and `acceptEdits`, `deny` in `plan`, and
      `resolvePermissionByPolicy` returns `deny`; `hasUnevaluableArgumentPattern` is `true` for each
      and `false` for `https://sub.example.com/ok`. A PATTERN that is unevaluable — rejected by the grammar, or accepted and then failing a rule —
      `WebFetch(https://user@*.example.com/**)`, `WebFetch(https://*.example.com/x?q=1)`,
      `WebFetch(https://a**b.example.com/**)`, `WebFetch(https://exa mple.com/**)` — is unevaluable
      for any argument, with the same verdicts. With `deny: ['WebFetch(*)']` (what a preset
      `deniedTools: ['WebFetch']` produces) every argument returns `deny`.
- [ ] TC-04: Paths: `allow: ['Read(/src/*)']` → `auto` for `/src/a.ts`, NOT for `/src/a/b.ts`;
      `allow: ['Read(/src/**)']` → `auto` for `/src/a/b.ts`; `deny: ['Read(/w/secrets/**)']` →
      `deny` for `/w/src/../secrets/x` and for `C:\w\secrets\x` under `deny: ['Read(C:/w/secrets/**)']`;
      `deny: ['Read(/w/**)']` with `src/x` (relative) → `approve` in `default` (unevaluable);
      `deny: ['Read(*)']` → `deny` for `/any/path`. Red before the fix for the first refusal and the
      `..` case.
- [ ] TC-05: Commands unchanged: `allow: ['Bash(git *)']` → `auto` for `git status` and
      `git add src/x`; a `text`-kind profile matches `Tool(a/*)` against `a/b/c` (today's glob).
- [ ] TC-06: Shipped declarations, the bare-wildcard contract and the type: `getToolPermissionProfile(name).argument?.kind`
      is `'url'` for `WebFetch`, `'path'` for `Read`/`Write`/`Edit`, `'command'` for `Bash`/`Shell`
      (and `ExecuteCommand`/`BackgroundProcess` in `agent-framework`), `'text'` for
      `Glob`/`Grep`/`WebSearch`, asserted by a test in each package; with the real profiles
      registered, `toolNamesToPatterns(['WebFetch', 'Write'])` as a deny list denies
      `https://any.host/` and `/any/path`, and `toolNamesToPatterns(['Read'])` as an allow list
      auto-approves `/any/path`; a KEYLESS tool under `deny: ['Keyless(*)']` returns `deny` (today:
      `approve`); `permission-gate.test.ts` carries a `// @ts-expect-error` registration of
      `{ argument: { key: 'x' } }`, so `pnpm typecheck` is red if the requirement is ever loosened.
      Red before the fix (no kinds; keyless `(*)` prompts).
- [ ] TC-07: Applied-check mutation: routing `url` to the string glob makes TC-01's placement
      refusals and TC-02 red; routing `path` to the glob makes TC-04's segment and `..` cases red;
      returning `no-match` instead of `unevaluable` — for the argument side and, separately, for an
      unevaluable pattern (grammar-rejected or rule-rejected) — makes TC-03's `approve`/`deny` cases red; nothing outside those.
- [ ] TC-08: `pnpm -r --filter ...` `build`, `typecheck` and `test` for the four packages
      (`agent-core`, `agent-tools`, `agent-framework`, `agent-session`) exit 0; `pnpm harness:scan` exit 0; `packages/agent-core/docs/SPEC.md` § Permission Argument
      Registry Public API names `IToolPermissionArgument` and the kinds' grammar, § Evaluation
      Algorithm step 2 enumerates every unevaluable condition and the keyless `Tool(*)` verdict
      (SPEC scans pass).

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                                                    | Notes                                            |
| ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| TC-01 | Unit      | vitest `permission-gate.test.ts`, `evaluatePermission`/`matchesAnyPattern` with a `url`-kind profile                               | red-proof recorded before the matcher lands      |
| TC-02 | Unit      | vitest, the canonicalisation, IPv6 and percent-encoding cases                                                                      | the anti-goal, stated in the test names          |
| TC-03 | Unit      | vitest, deny-direction cases across modes and `resolvePermissionByPolicy`; rejected patterns                                       | the third state, stated in the test names        |
| TC-04 | Unit      | vitest, `path`-kind profile incl. `..`, relative and Windows cases                                                                 | red-proof for the `/`-crossing and `..` refusals |
| TC-05 | Unit      | vitest, `command`- and `text`-kind profiles                                                                                        | unchanged semantics pinned                       |
| TC-06 | Unit      | vitest in `agent-tools` and `agent-framework` against the registered profiles; keyless `(*)`; `@ts-expect-error` under `typecheck` | red-proof: kinds absent before the fix           |
| TC-07 | Mutation  | redirect one kind / one state, run the file, restore, record counts                                                                | `git diff --stat` empty after restore            |
| TC-08 | Build     | pnpm build/typecheck/test for the four packages; `pnpm harness:scan`; SPEC scans                                                   |                                                  |

## Tasks

- [ ] `.agents/tasks/CORE-049-permission-patterns-match-by-argument-kind.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 0 numbered alternative(s), 2 required
  **Required action:** add alternatives
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 6 item(s) without a `TC-NN:` prefix: "**TC-01** URL placements: with `allow: ['WebFetch("
  **Required action:** prefix every criterion with TC-NN:
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 6 rows vs 0 TC criteria; rows without a criterion: TC-01, TC-02, TC-03, TC-04, TC-05, TC-06
  **Required action:** one row per TC-NN, same ids

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 0 numbered alternative(s), 2 required
  **Required action:** add alternatives

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — At least 1 criterion per distinct feature or sub-item (`semantic`): Solution item 5 ("The three profile files declare kinds for every shipped tool" — `WebFetch → url`, `Read`/`Write`/`Edit → path`, `Bash`/`Shell`/`ExecuteCommand`/`BackgroundProcess → command`; Affected Files rows for `packages/agent-tools/src/tool-permission-profiles.ts` and `packages/agent-framework/src/tools/tool-permission-profiles.ts`) has no TC: TC-01–TC-05 run against a test-registered `url`/`path`/`command`-kind profile inside `agent-core`, and TC-06 checks build/test/scan/SPEC only. Because an undeclared kind defaults to `text` (today's glob), a missing or wrong shipped declaration leaves `WebFetch` on the vulnerable matcher with every listed TC green — the Landing path itself names this as the failure mode ("or the shipped tools keep the string glob for one release"). Second gap under the same criterion: Solution item 3 / Fallback & Degradation declare that an unparseable URL argument under a `url` pattern is a non-match on allow and deny and falls through to the mode policy (prompt for `inspect` in `default`); no TC observes it.
  **Required action:** add a TC that observes the shipped declarations (e.g. in `packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts` and the framework counterpart: the registered profile for `WebFetch` has `argumentKind: 'url'`, `Read`/`Write`/`Edit` `'path'`, the command tools `'command'`), and a TC for the unparseable-argument verdict (`allow`/`deny: ['WebFetch(https://*.example.com/**)']` with a non-URL argument → not `auto`, and the deny case → the mode policy's verdict, not `deny`); add matching Test Plan rows.

Semantic criteria observed as met on this run (evidence, not partial credit): Problem concrete symptom — measurement re-run with `globToRegex` copied verbatim from `permission-gate.ts:41-47` (compiled regex `^https:\/\/.*\.example\.com\/.+$`): all five listed URLs MATCH, `https://example.com/` does not, `Read(/src/*)` matches `/src/a/b/c`; `matchesPattern` is at :176-195 and calls `globToRegex(parsed.argPattern).test(primary)` at :194; both profile files exist and declare `argumentKey`/`riskClass` only, `argumentKind` occurs nowhere under `packages/*/src`. Reproduction condition — stated in the Problem (`WebFetch(scheme://…)` and any `*` path pattern) at a named commit `dd46c9183`. Research feeds Decision — the WHATWG claim verified with `new URL` (`0x7f.1`, `2130706433`, `127.1`, `①②⑦.0.0.1` → `127.0.0.1`; `EXAMPLE.com` → `example.com`; `sub.example.com@evil.tld` → host `evil.tld`, username `sub.example.com`) and it is what A1/TC-02 rest on and what rejects A3; the Claude Code rule forms (`WebFetch(domain:example.com)`, `Bash(npm run *)`, "Tool-specific permission rules") are present in the official documentation, now at `https://code.claude.com/docs/en/permissions` — the cited `…/claude-code/iam` URL 301s to `code.claude.com/docs/en/iam`, which is the Authentication page (pointer should be updated; not a failing item). Decision names the trade-off — declaration-in-profile over shape inference (A2) and parsing over escaping (A3), with the accepted costs stated: undeclared third-party tools stay on the glob, the command-separator residual deferred to issue #2427 (exists, open). New-surface placement — N/A with reason: `argumentKind` is an optional field on the existing exported `IToolPermissionProfile` (`permission-gate.ts:75`, beside `argumentKey` :83); no new package/app/surface. Command/observable form — every TC states inputs and a `auto`/`deny`/not-`auto` verdict or a command with exit code; TC-05 states the expected red set.

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — At least 1 criterion per distinct feature or sub-item (`semantic`): two stated sub-items have no TC that observes them. (1) The type-level requirement that `argumentKey` and `argumentKind` are declared together — Solution 1 ("a union: both present, or neither"), Fallback & Degradation ("A profile that declares `argumentKey` without `argumentKind` does not type-check"), Landing path ("the type makes a half-landing a compile error"), A1's Pro ("covered by a type-level requirement, not a documented default"). TC-08's `build` exit 0 shows the tree compiles; it cannot observe that a key-without-kind profile is REFUSED. With `argumentKind` merely optional, TC-01–TC-08 all stay green and a registrant with a key and no kind lands in a case Solution 2 does not enumerate (key known, kind absent). (2) The pattern-side unevaluable condition for `url` — Solution 3 ("no query/fragment/userinfo allowed in a pattern … every uninterpretable case → unevaluable"), A1 ("a pattern the grammar does not accept → unevaluable"), Fallback ("An uninterpretable pattern or argument … is unevaluable"). TC-03's three unevaluable cases (`sub.example.com@evil.tld`, `not a url`, `file:///etc/passwd`) are all ARGUMENT-side; TC-07's mutation redirects only those. No TC feeds a pattern the grammar rejects (e.g. `WebFetch(https://user@host/**)`, `WebFetch(https://h/?q=1)`) and observes `approve` in `default`/`acceptEdits`, `deny` in `plan`, `deny` from `resolvePermissionByPolicy`, `hasUnevaluableArgumentPattern` true. Issue #2428 defers LOAD-time refusal, so the gate's verdict on a malformed pattern is this item's to observe.
  **Required action:** add a TC (or extend TC-06/TC-03) that observes the type rejection — e.g. a `// @ts-expect-error` registration `{ argumentKey: 'x' }` without a kind in `permission-gate.test.ts` (typecheck runs under the test/build already listed in TC-08) — and a TC (or TC-03 cases) for a grammar-rejected `url` pattern across the two modes and the resolver, plus the matching mutation arm in TC-07; add/adjust Test Plan rows so the count still matches.

Semantic criteria observed as met on this run (evidence, not partial credit): Problem concrete symptom — measurement re-run at `origin/develop` `dd46c9183` with `globToRegex` copied verbatim from `permission-gate.ts:41-47` (compiled `^https:\/\/.*\.example\.com\/.+$`): all five listed URLs MATCH, `https://example.com/` does not, `Read(/src/*)` matches `/src/a/b/c`; `matchesPattern` at :176-195 calls `globToRegex(parsed.argPattern).test(primary)` at :194; both profile files declare `argumentKey`/`riskClass` only, `argumentKind` has 0 occurrences under `packages/*/src`. Reproduction condition — stated (every `WebFetch(scheme://…)` pattern; every `*` path pattern) at a named commit. Research feeds Decision — WHATWG claims re-measured in Node v22.14.0: `0x7f.1`, `2130706433`, `127.1`, `①②⑦.0.0.1` → `127.0.0.1`, `EXAMPLE.com` → `example.com`, `example.com.` keeps its trailing dot, `*://x/` and bare `*` throw `ERR_INVALID_URL`, `https://x` and `https://x/` both give `pathname: '/'`, `sub.example.com@evil.tld` → host `evil.tld` username `sub.example.com`, `file:///etc/passwd` parses with empty host — exactly what drives the pattern-side grammar split (Solution 3), the trailing-dot rule and the userinfo/host-less unevaluable cases (A1), and rejects A3; the cited `code.claude.com/docs/en/permissions` page fetched today contains `WebFetch(domain:` (11), `Bash(npm run` (4), "Tool-specific permission rules" (3), gitignore-style `Read(/secrets/**)`/`Edit(/src/**/*.ts)` forms — the three-kinds + bare-wildcard shape A1 adopts. Decision names the trade-off — A1 over A5: a prompt where a silent pass used to be, versus the fail-open boolean; declaration over inference (A2); parsing over escaping (A3); residuals filed and verified OPEN: issue #2427, issue #2428, issue #2429; issue #2026 (depends on this) OPEN. Cited code verified: `RISK_CLASS_POLICY` `inspect: 'auto'` in all four modes (`permission-mode.ts:57-78`; the spec's `:62-66` names only the `default` block — imprecise citation, not a failing item); `toolNamesToPatterns` maps every name to `${name}(*)` (`tool-list-patterns.ts:9-11`) so the bare-wildcard rule is the preset contract; `hasUnevaluableArgumentPattern(toolName, _args, patterns)` at `permission-gate.ts:155-169` ignores `_args` and returns only `argumentKeyFor(toolName) === undefined`; `evaluatePermission` routes it `plan → 'deny'`, else `'approve'` at :226-228 before the allow list at :231; `resolvePermissionByPolicy` routes it to `'deny'` at `permission-policy.ts:64-68`. New-surface placement — N/A with reason verified: `argumentKind` is a field beside `argumentKey` (:83) on the existing exported `IToolPermissionProfile` (:75); no new package/app/surface; both consumers keep the same two exports. Command/observable form — TC-01–TC-08 each state inputs and a verdict (`auto`/`approve`/`deny`/not-`auto`), a boolean, a mutation red-set, or an exit code. Coverage otherwise verified: Solution 5 / both profile files / both profile tests → TC-06 (asserts `getToolPermissionProfile(name).argumentKind` per package, `Tool(*)` through the real profiles); Solution 4 → TC-04; Solution 2's bare-wildcard → TC-03/04/06; the `agent-session` row resolves to `selfhost-009-permission-decision-hook.test.ts` (has `argumentKey`); 25 `argumentKey:` test registrations across 6 files, matching the "~25" claim; `agent-framework/src/tools/__tests__/tool-permission-profiles.test.ts` does not exist today, consistent with the row's "new"; SPEC sections § Permission Argument Registry Public API (:313) and § Evaluation Algorithm (:825) exist. Ordering check: GATE-WRITE is the entry gate (exempt); status `draft`, file under `draft/`.

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

Semantic set, judged by `backlog-gate-guard` on the text after the `proposal-reviewer` round-2 rewrite; the mechanical set was judged by `node scripts/harness/gate.mjs judge --gate GATE-WRITE` on the same text (27 criteria: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN — the seven below). Ordering check: GATE-WRITE is the entry gate (exempt from a prior gate); `status: draft`, file under `draft/`, lane L2; tree at `origin/develop` `dd46c9183`, the spec and its paired Task untracked, nothing implemented (`argumentKind`/`IToolPermissionArgument`: 0 occurrences under `packages/`).

- GATE-WRITE — Problem: contains a concrete symptom: MET. Measurement re-run with `globToRegex` copied verbatim from `permission-gate.ts:41-47` (compiled `^https:\/\/.*\.example\.com\/.+$`): all five listed URLs MATCH (`sub.example.com/ok`, `evil.tld/?a=…`, `evil.tld/#…`, `169.254.169.254/?x=…`, `evil.tld/.example.com/x`), `https://example.com/` does not, `Read(/src/*)` matches `/src/a/b/c`; `matchesPattern` is at `:176-195` and calls `globToRegex(parsed.argPattern).test(primary)` at `:194`; both profile files declare `argumentKey`/`riskClass` only.
- GATE-WRITE — Problem: contains a reproduction condition: MET. "Any wildcard pattern evaluated against an argument whose delimiters the wildcard may cross: every `WebFetch(scheme://…)` pattern; every path pattern with `*`", at a named commit, with the operator's natural pattern (`WebFetch(https://*.corp.example.com/**)`) as the trigger.
- GATE-WRITE — Research findings feed Alternatives / Decision: MET. Every WHATWG claim re-measured in Node v22.14.0: `0x7f.1`, `2130706433`, `127.1`, `①②⑦.0.0.1` → `127.0.0.1`; `EXAMPLE.com` → `example.com`; `[0:0:0:0:0:0:0:1]` → `[::1]`; `example.com.` keeps its dot; `foo://0x7f.1/` hostname stays `0x7f.1` and `foo://EXAMPLE.com` stays upper-case; `*://x/` and bare `*` throw `ERR_INVALID_URL`; `https://x` and `https://x/` both give `pathname '/'`; `https://h/%61dmin/x` keeps `/%61dmin/x` while `/a/./b/../c` → `/a/c`; `sub.example.com@evil.tld` → host `evil.tld`, username `sub.example.com`; `file:///etc/passwd` → empty host; `decodeURIComponent('%E0%A4%A')` throws `URIError`; `path.posix.isAbsolute('C:\\x')` and `('C:/x')` are both false (which is why A1/Solution 4 define the drive prefix themselves); `path.posix.normalize('/w/src/../secrets/x')` → `/w/secrets/x`; `domainToASCII('exa mple.com')` → `''`. Each drives a stated rule (pattern-side grammar split, special-scheme-only, userinfo/host-less/undecodable-segment unevaluable, percent-decoded segment comparison, Windows drive rule) and rejects A3. The cited `code.claude.com/docs/en/permissions` fetched today contains `WebFetch(domain:` (20), `Bash(npm run` (8), "Tool-specific permission rules" (4), gitignore-style forms (13) — the three-kinds + bare-wildcard shape A1 adopts. The Solution 3 grammar regex, run as written: accepts `https://*.example.com/**`, `http://127.0.0.1/**`, `http://[::1]/**`, `https://h/admin/**`, `*://x/`, `https://*:8443/**`; rejects `https://user@*.example.com/**`, `https://*.example.com/x?q=1`, `…/x#f`.
- GATE-WRITE — Decision references the trade-off: MET. A1 over A5 — "a third state costs every consumer nothing (both already route it) and costs the operator a prompt where a silent pass used to be; the alternative (A5) is the fail-open shape this item exists to remove"; declaration over inference (A2), parsing over escaping (A3), one object over a union (A6, and `code-quality.md:20` does require `interface` for object shapes); the accepted costs named (~27 declaration sites — measured 25 test registrations across five files in `agent-core`/`agent-session` plus the two profile files; new grammar code to pin); the keyless `Tool(*)` verdict change stated (`CodebaseRetrieval` is keyless in the shipped profile; today `matchesPattern` :190-192 returns `false` on a missing primary and `hasUnevaluableArgumentPattern` :168 returns `true` → `approve`). Residuals filed and OPEN: issues #2427, #2428, #2429, #2430; issue #2026 (depends on this) OPEN. Cited code verified: `RISK_CLASS_POLICY` `inspect: 'auto'` in all four modes (`permission-mode.ts:57-78`); `toolNamesToPatterns` → `${name}(*)`; `resolvePermissionByPolicy` routes unevaluable to `'deny'` (`permission-policy.ts:64-68`); `permission-enforcer.ts:167-193` calls only the two exports; `web-fetch-tool.ts:145` is `new URL(url)`; `PROFILE_KEY_RE` (`scan-tool-classification.mjs:36`, `m` flag, `^\s*name\s*:\s*\{`) would indeed read a line-leading `argument: {` as a tool name.
- GATE-WRITE — New-surface placement (conditional): N/A, reason verified — `IToolPermissionArgument` is a nested interface on the existing exported `IToolPermissionProfile` (`permission-gate.ts:75`, replacing `argumentKey` at `:83`); no new package, app, presentation or interface surface; both consumers keep the same two exports; the Sibling scan line says so and names the consumers.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: MET (this decided the prior two runs). Solution 1 / Fallback "key without kind does not type-check" → TC-06 `// @ts-expect-error` registration under `pnpm typecheck` — verified observable: `agent-core` `typecheck` is `tsgo -p tsconfig.json --noEmit` with `include: ["src/**/*"]` and no test exclusion, so `__tests__` files are type-checked. Solution 2 tri-state and bare wildcard → TC-03 (`WebFetch(*)`), TC-04 (`Read(*)`), TC-06 (real profiles, keyless `Keyless(*)` → `deny`, "today: `approve`" verified above). Solution 3 → TC-01 (placement, port default, apex), TC-02 (IPv4 forms, IPv6 literal, case, percent-encoded path), TC-03 (argument side: userinfo, unparseable, `file:`, non-special `foo://`, undecodable segment; pattern side: four rejected patterns, in `default`/`acceptEdits`/`plan` and the resolver, `hasUnevaluableArgumentPattern` both ways). Solution 4 → TC-04 (`*` not crossing `/`, `**`, `..`, Windows `C:\w\secrets\x` under `C:/w/secrets/**`, relative → unevaluable). Solution 5 → TC-06 (shipped kinds asserted per package, incl. `ExecuteCommand`/`BackgroundProcess`) and TC-08 (`typecheck` forces every `argumentKey:` registration — 25 measured — to the object form; `MyTool` as `text` keeps `unknown-tool-deny.test.ts` green); the framework test file the header comment claims does not exist today (`packages/agent-framework/src/tools/__tests__/` holds three other tests) and TC-06/the "new" row create it. Solution 6 → TC-01–TC-08. TC-07 carries mutation arms for `url`, `path`, the argument-side and, separately, the pattern-side unevaluable. Every Affected Files row maps: `permission-gate.ts` → TC-01–06; `permission-gate.test.ts` → TC-01–04/06; other registrations and `selfhost-009*` (has 2 `argumentKey:` lines) → TC-08; both profile files and both profile tests → TC-06; SPEC (§ Permission Argument Registry Public API `:313`, § Evaluation Algorithm `:825` exist) → TC-08.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: MET. TC-01–TC-06 each name the lists, the argument, the mode and the verdict (`auto`/`approve`/`deny`) or the boolean; TC-07 names the mutation and the red set; TC-08 names the commands, the exit codes and the SPEC sections.

Non-failing observations for the author (no criterion turns on them): (a) TC-03 labels `https://a**b.example.com/**` and `https://exa mple.com/**` "patterns the grammar rejects", but the Solution 3 regex ACCEPTS both (its host class admits `*` and space) — they become unevaluable one step later, by A1's `a**b` rule and by the literal-host parse (`http://exa mple.com/` throws), so the stated verdicts hold; the label is imprecise, the observation is not. (b) TC-02's trailing-dot vector `http://127.0.0.1./` is already canonicalised by the parser (hostname `127.0.0.1`), so the "drop one trailing dot" rule for domain hosts (`example.com.` stays) is not observed by any vector; `http://example.com./` under `example.com` would observe it. (c) A6's Con cites `exactOptionalPropertyTypes`; no tsconfig in the repo enables it (base is `strict` only) — the primary reason (`code-quality.md:20`) stands on its own. (d) The Task's only DONE-GATE-STAGE-1 entry is a FAIL "on FORM only", with the canonical-form rewrite recorded above it; that gate is not this one's to judge.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 (권장)"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** fab89dc65b4f (review 4ca29292, type/tags 98870c9c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (fab89dc65b4f) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: MET. Semantic set judged by `backlog-gate-guard` on 2026-08-29 (mechanical set: `gate.mjs judge --gate GATE-APPROVAL`, 6 PASS / 0 FAIL / 3 PENDING-GUARDIAN). Provenance stated plainly: the guard did not observe the selection; the dispatch carries it, and the `**Instruction (verbatim):** "승인 (권장)"` field `gate.mjs approve` recorded above is the same string. The question the owner answered in this conversation was headed "GATE-APPROVAL" and opened "CORE-049 (issue #2350, P1 보안) GATE-APPROVAL — Route DIRECT. spec: `.agents/spec-docs/backlog/CORE-049-permission-patterns-match-by-argument-kind.md` (lane L2)", then summarised § Decision A1 as it stands on disk — `argument: { key, kind }` declared by the tool profile, the third state `unevaluable` for what cannot be interpreted, and the consequence that `Tool(*)` matches keyless tools (the `CodebaseRetrieval` verdict change A1 names) — and asked "승인하시겠습니까?" with options "승인 (권장)" / "보류 — 질문 있음" / "거절". The selected option is "승인", the first form the catalogue lists as explicit approval; it is not an answer to a clarifying question, not silence, and not approval of another item (the question names this ID, this issue, this path, this lane and this decision). Not a relay: given in this document's own conversation, on the approval date.
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A. Route is `DIRECT`; no class is claimed, so there is no registry boundary to evaluate (the only registered class, `LANE-L0-L1`, would not cover a lane-L2 document in any case).
- GATE-APPROVAL — Independent architecture validation (conditional): N/A, reason verified. The spec introduces no new package, app, presentation or interface surface and reclassifies no layer or product-family boundary: `IToolPermissionArgument` is a nested interface on the existing exported `IToolPermissionProfile` (`packages/agent-core/src/permissions/permission-gate.ts:75`, replacing `argumentKey` at `:83`); every Affected Files row is an existing file except one new test file (`packages/agent-framework/src/tools/__tests__/tool-permission-profiles.test.ts`), which is not a surface; the Sibling scan line records `N/A for new-surface placement` with the two unchanged consumers. No `proposal-reviewer` placement verdict is therefore required. Ordering check: GATE-WRITE `✅ PASS | 2026-08-29` is the last GATE-WRITE entry (four resolved FAIL entries precede it) and carries per-criterion lines; `status: review-ready`, file under `backlog/` (the mapping `spec-workflow.md` gives for `review-ready`); lane L2. NON-COMPLIANCE trigger checked: branch `fix/2350-permission-patterns-match-by-argument-kind` at `dd46c9183` = `origin/develop`, 0 commits ahead, the spec and its paired Task (`status: todo`) are the only untracked files; `IToolPermissionArgument`/`argumentKind` have 0 occurrences in `permission-gate.ts` and the `agent-core` dist typings — nothing implemented before this gate.

---
title: 'SEC-004: close the five remaining HIGH CodeQL alerts (double-escaping, redos, missing-regexp-anchor)'
status: done
created: 2026-07-26
completed: 2026-07-26
priority: high
urgency: now
area: packages/agent-tools, packages/agent-cli, scripts/harness
depends_on: []
---

# SEC-004: the five HIGH CodeQL alerts SEC-003 did not cover

## Problem

[SEC-003](SEC-003-codeql-alert-triage.md) closed both classes it opened with —
`js/insecure-temporary-file` (109/109) and `js/polynomial-redos` (18/18) — at the source, zero
dismissals. Five HIGH-severity alerts on `develop` belong to three other classes it never opened,
and were still open (identical on PR #1427, so pre-existing rather than introduced there):

| Alert | Rule                             | Site                                                             |
| ----- | -------------------------------- | ---------------------------------------------------------------- |
| 1     | `js/double-escaping`             | `agent-tools/src/builtins/web-fetch-tool.ts:85`                  |
| 2     | `js/redos`                       | `scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs:54`  |
| 3–5   | `js/regex/missing-regexp-anchor` | `agent-tools/src/__tests__/web-search-provider.test.ts:75,76,88` |

SEC-003's own lesson applies again: the alert list is a floor, not an inventory. The sweep for both
shapes across the repo found one more live defect of each shape that CodeQL never reported.

## Alert 1 — `js/double-escaping`, `web-fetch-tool.ts` (shipped library code)

`htmlToText` decoded entities as a CHAIN of `.replace()` calls with `&amp;` FIRST, so each pass
re-scanned the previous pass's output. `&amp;lt;` — how a page encodes the literal text `&lt;` so a
browser DISPLAYS it — became `&lt;` after the `&amp;` pass and then `<` after the `&lt;` pass.

Measured on the pre-fix code:

| Input                                                   | Pre-fix output              | Correct                                 |
| ------------------------------------------------------- | --------------------------- | --------------------------------------- |
| `&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;` | `<script>alert(1)</script>` | `&lt;script&gt;alert(1)&lt;/script&gt;` |
| `&amp;quot;`                                            | `"`                         | `&quot;`                                |
| `&amp;#39;`                                             | `'`                         | `&#39;`                                 |

So a **tag-stripping** converter handed the model back markup that the page had deliberately escaped
for display — the decoder was not the inverse of the encoder, which is precisely what
`js/double-escaping` names. The output is a `WebFetch` tool result, i.e. a live response body from an
arbitrary URL, so the attacker chooses the input.

**Fix:** one alternation over all six entities, applied in a single `.replace()` pass with a lookup
table. A global replace never re-scans its own replacement, so every entity is decoded exactly once
and the decoder inverts the encoder for every input, not only singly-encoded ones. Ordering `&amp;`
last would also have worked; a single pass was chosen because it is correct by construction rather
than by argument about pass order — the same reasoning SEC-003 used when it replaced regexes with
index scans.

## Alert 2 — `js/redos`, `frontmatter-parser-ssot.test.mjs`

The regex-literal extractor's character-class body was `(?:\\.|[^\]])*`. Both branches match a
backslash — `\\.` takes it together with the next character, `[^\]]` takes it alone — so a run of
backslashes inside a `[…]` that never closes has 2^n parses, and the engine tries all of them before
the match fails. This is **exponential**, not the polynomial class SEC-003 handled.

Measured (`' /[' + '\\'.repeat(n) + '!'`): n=30 → 8.6 ms, n=34 → 308 ms, n=38 → 2 128 ms,
n=42 → 14 533 ms. Fixed: 0.1 ms at n=42, 1.3 ms at n=200 000.

**Fix:** `[^\]]` → `[^\]\\]`, making exactly one branch match at every position. Inside a regex
character class a backslash always begins an escape, so `\\.` already covered every well-formed
input — the extracted literals are unchanged, pinned by an equivalence test that passes against both
the pre-fix and post-fix pattern.

**Honest scoping note:** the input is a harness `.mjs` file on disk in this repo, not
attacker-supplied. This is a build-availability defect (any harness script that grows a `[` followed
by a backslash run hangs `harness:verify`), not a remote DoS. It was fixed rather than dismissed
because the fix is one character, provably behaviour-preserving, and the alert is correct about the
regex.

## Alerts 3–5 — `js/regex/missing-regexp-anchor`, `web-search-provider.test.ts`

These three deserve a precise verdict, because the rule's usual narrative does not fit and the
defect is real anyway.

All three sites are **negative** assertions (`expect(x).not.toMatch(...)`). An unanchored regex in a
negative check over-matches, which makes a test fail loudly — it cannot make it pass silently. So
"an unanchored allow-check accepts `evil.com/notexample.com`" is not what is happening here.

The defect is the mirror image, and is genuine: these are **substring searches written as regexes**,
and the set of strings each one rejects is far narrower than the property its test name claims.

- `it('the tool-layer source holds no vendor endpoint or signup-URL literal')` rejected exactly two
  spellings (`api.search.brave.com`, `brave.com/search`). A comment reading `cdn.brave.com/docs`
  satisfies every assertion while violating the claim.
- `it('default missing-key error … carries no vendor signup URL')` rejected exactly
  `https://brave.com`. The vendor's real key-signup URL, `https://api.search.brave.com/app/keys`,
  sails straight through the check that exists to keep it out.

**Fix:** state the substring search as a substring search (`not.toContain`), which removes the regex
and with it the anchoring question, and widen the probe to the property actually claimed — the
vendor host in ANY spelling (`brave.com` covers every subdomain, path, and scheme) plus "no URL at
all". Both are strictly stronger than what they replace.

## Same-shape sweep — instances CodeQL did not flag

### Fixed here

| Site                                                                              | Shape                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-cli/src/remote-control/__tests__/remote-control-controller.test.ts:93,218` | Unanchored `toMatch(/https:\/\/remote\.example\//)` over a whole multi-line message. A pairing link served from `https://phish.test/?next=https://remote.example/` passes both assertions — proven: the pre-fix suite is 15/15 green with that origin injected. Fixed by extracting the link (it is the message's last line) and comparing `new URL(link).origin` exactly, plus asserting `search === ''` so the secret is pinned to the fragment. |

### Cleared — same construct, correct as written (no change made)

- `agent-provider-openai-compatible/src/gemma/pseudo-tool-call-tag-parser.ts:140-144` —
  unescape chain with `&amp;` **last**. Correct order; `&amp;lt;` → `&lt;`.
- `agent-framework/src/context/prompt-file-reference-format.ts:69-72`,
  `dag-cli/src/studio/ui-html.ts:102` — escape chains with `&` **first**. Correct order.
- `agent-playground/.../sse-client.ts:143-146` (`^wss`→`https` then `^ws`→`http`; `https` cannot be
  re-matched by `^ws`), `apps/docs/src/lib/toc.ts`, `dag-cli/src/commands/aav.ts` (idempotent
  slugifiers), `agent-remote-pairing/.../pairing.test.ts` (base64url encode).
- `agent-core/src/permissions/permission-gate.ts:40` and
  `agent-tools/src/builtins/grep-tool.ts:65` — both `globToRegex` helpers anchor with `^…$`.
- `agent-transport-ws/src/ws-connection-guards.ts` — the `Host`/`Origin` admission guards use exact
  `Set` membership and `new URL(origin).hostname`, never a substring or regex. This is the shape
  done right.
- `agent-core/src/hooks/hook-runner.ts:55` (`new RegExp(group.matcher).test(toolName)`) and
  `agent-core/src/schema/structured-output.ts:161` (JSON Schema `pattern`) are unanchored **by
  contract** — a hook matcher and JSON Schema `pattern` are both specified as partial matches.
  Anchoring them would be a breaking behaviour change, not a fix.

### Follow-up opened by this sweep — NOT fixed here

**`packages/dag-nodes/text-template/src/index.ts:79-82` re-substitutes its own substitution output.**
Same root cause as alert 1 (a later pass re-scans an earlier pass's replacement), different surface,
so it is a behaviour change to a DAG node rather than a regex fix and is outside this item's file
ownership. Measured:

| Template           | `text` input                    | Produced        | Expected                   |
| ------------------ | ------------------------------- | --------------- | -------------------------- |
| `{{text}}`         | `a%sb`                          | `aa%sbb`        | `a%sb`                     |
| `{{text}}`         | `x%%sy`                         | `x%x%%syy`      | `x%%sy`                    |
| `{{text}}`         | `pre__ROBOTA_…_PERCENT_S__post` | `pre%spost`     | the sentinel back verbatim |
| `%%s and {{text}}` | `q%sr`                          | `%s and qq%srr` | `%s and q%sr`              |

The `{{text}}` substitution runs BEFORE the `%s` substitution, so any `%s` inside the user's text is
substituted a second time; and the escape sentinel is an ordinary string a user can type. The
correct shape is a single left-to-right scan that emits substituted text without re-reading it.

## Test Plan

- Red-first per fix; every red is an assertion failure carrying its own value/elapsed time, not a
  timeout. See the evidence table below.
- New test file `packages/agent-tools/src/__tests__/double-escaping.test.ts` (5 cases): the
  doubly-encoded cases, a display-encoder round-trip, plus equivalence pins for singly-encoded input
  and for entities the decoder does not handle.
- New cases inside `scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs`: an attack-input
  timing floor (`< 250 ms`) and a literal-extraction equivalence pin.
- Full test suites of every touched package, plus `pnpm harness:verify-like-ci`.

### Red-first evidence

| Test                                                                      | Pre-fix                                    | Post-fix                                |
| ------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| `double-escaping` — doubly-encoded entity                                 | `<` (3 of 5 cases red)                     | `&lt;`                                  |
| `double-escaping` — escaped-twice markup                                  | `<script>alert(1)</script>`                | `&lt;script&gt;alert(1)&lt;/script&gt;` |
| `frontmatter-parser-ssot` — unclosed class, 42 backslashes                | 2 735 ms (budget 250 ms)                   | 12 ms for the whole file                |
| `web-search-provider` — vendor URL leaked into the tool layer / key error | pre-fix suite 4/4 **green** (accidental)   | 2 of 4 red                              |
| `remote-control-controller` — pairing link on `https://phish.test/`       | pre-fix suite 15/15 **green** (accidental) | 2 of 15 red                             |

The two "accidental green" rows are the point: the pre-fix assertions passed on input they exist to
reject, so those tests did not test what their names claimed.

**Dismissed: none. 5 of 5 fixed at the source, plus 1 same-shape defect CodeQL never reported, plus
1 filed as a follow-up.**

## Closing verification (2026-07-26)

Re-derived from the tree and from the live alert list, not from this document's own prose.

**All three classes are absent from `develop`.** Paginated query (the SEC-006/SEC-007 discipline —
an unpaginated read of this endpoint reports `0 high` on any ref):

```
$ gh api "repos/woojubb/robota/code-scanning/alerts?state=open&ref=refs/heads/develop&per_page=100" \
    --paginate --jq '.[].rule.id' | sort -u | grep -E 'double-escaping|js/redos|missing-regexp-anchor'
(no output — 0 matches)
```

The five alerts this item opened with (`js/double-escaping` ×1, `js/redos` ×1,
`js/regex/missing-regexp-anchor` ×3) no longer appear in the 17 rule ids still open.

**Each fix verified present in the tree:**

| Fix                                         | Where it landed                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Alert 1 — single-pass entity decode         | `packages/agent-tools/src/builtins/web-fetch-tool.ts:93-106` (`HTML_ENTITIES` table + one `.replace`, no chain)     |
| Alert 2 — exponential class body            | `scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs:68` — the literal extractor's class body is `[^\]\\]`   |
| Alerts 3–5 — substring search stated as one | `packages/agent-tools/src/__tests__/web-search-provider.test.ts:18,86,101` (`VENDOR_HOST` + `not.toContain`)        |
| New coverage                                | `packages/agent-tools/src/__tests__/double-escaping.test.ts` — 5 `it` blocks (`:56,65,73,80,87`)                    |
| Sweep instance CodeQL did not flag          | `packages/agent-cli/src/remote-control/__tests__/remote-control-controller.test.ts:112-114,242` (`origin`/`search`) |

**Merged as** [#1443](https://github.com/woojubb/robota/pull/1443) / [#1451](https://github.com/woojubb/robota/pull/1451)
in the same wave as SEC-005/SEC-006.

**The one follow-up this item opened is NOT fixed and has moved.** `packages/dag-nodes/text-template/src/index.ts:79-82`
still re-substitutes its own substitution output (line 81 splits on `%s` over line 80's output). Verified
present on `develop` today. It is now carried by `SEC-007`'s `## Carried onward` list, which is the live
tracker for the chain's tail — so archiving this item does not drop it.

## User Execution Test Scenarios

Not applicable. `WebFetch`'s entity decoding is an internal correctness fix with no observable
command, TUI, or browser surface change for a well-formed page (the singly-encoded equivalence tests
pin that the ordinary output is byte-identical), and the other four alerts are test-code and
harness-script fixes that deliver no user-facing behaviour. The engineering verification lives in
`## Test Plan`.

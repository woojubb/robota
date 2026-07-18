# No-Fallback mechanical gate (HARNESS-028)

DONE 2026-07-18 (PR #1216). Closes the gap where the No Fallback Policy
([`../rules/operational.md`](../rules/operational.md)) was enforced ONLY by review — no scan covered
production `packages/` code (`conflict-markers` targets harness prose). Owner concern:
fake/mock/fallback are TEST-only terms, NEVER allowed in dev/prod; route fallback verification through
the spec-gate/backlog. See [[self-improving-harness-northstar]] (guardian must have a mechanical floor).

**Three layers:**

1. **Review** — `backlog-writer` spec-doc schema has `## Fallback & Degradation Declaration` (default
   "None"), judged by `proposal-reviewer` at GATE-APPROVAL. It lives on the gate-pipeline spec-doc, NOT
   the package `SPEC.md` template.
2. **Mechanical floor** — `scripts/harness/scan-no-fallback.mjs`, registered as `no-fallback` in
   `run-all-scans.mjs` (→ CI `scans` job + GATE-VERIFY). **v1 flags ONLY** a `catch` whose FIRST meaningful
   statement returns a bare default literal (`null`/`undefined`/`[]`/`{}`/`''`/`false`/`true`/`0`/`-1`)
   with NO `throw` — the silent swallow→default shape. Suppress with an adjacent `// allow-fallback: <reason>`
   (leading comment / inline on the return / trailing the closing brace). The brace-matcher is
   string+comment-aware; the catch match uses `(?<![.\w])` to exclude promise `.catch()` handlers.
3. **Anti-rot (v1 = reason-less-only)** — a reason-less `allow-fallback` in a comment fails (mypy
   `ignore-without-code` analogue). Stale-detection is DEFERRED (an annotation on a not-yet-scanned
   construct is inert, not stale).

**Precision rule that made it work:** the literal "catch returns any value" shape over-fires on legitimate
error-RESULT returns (`{ ok: false }`, `stringifyError(e)`, Result types) that the policy BLESSES — narrowing
to swallow→default kept false positives near zero. On introduction it surfaced 10 genuine un-annotated
sanctioned degradations + 1 JSDoc prose mention, each reason-stamped (zero behavior change); the ~130 existing
`allow-fallback:` colon-sites were already annotated — NOT a 357-site sweep.

**Deferred to v2:** the `f() || g()` both-calls rule (needs a `ruleid:`/`ok:` fixture corpus — can't tell
lazy-init `cache.get() || fetch()` from `primary() || fallback()`); stale-detection; `apps/<app>/src` scope.

Adding a NEW sanctioned fallback: declare it in the spec's Fallback & Degradation Declaration AND carry an
`// allow-fallback: <reason>` at the code site. Adding a NEW policy construct to the scan: pair it with the
stale-detection it unlocks.

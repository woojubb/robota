# A verification line in a report is not evidence the verification ran

**The sentence, because it is the whole entry:**

> The command has to be one you read out of `pnpm run`, not one you composed from a name you saw.

## Where it was learned, measured

SEC-016 (issue #2093). Every verification block I posted for several turns carried this line:

```
scenario:verify=0
```

produced by `pnpm scenario:verify` run from the repo root. **There is no `scenario:verify` script at
the root.** It is a package-level script, present in nine packages. The command never ran a single
scenario, and `=0` was not a passing gate — it was the absence of one.

I did not catch it by auditing. It surfaced only because it started returning **1** instead of
**0**, and I went to read why rather than re-running it. Had it kept returning 0 I would have kept
quoting it indefinitely.

## Why it is worse than having omitted the line

A phantom gate **displaces the real one in the reader's accounting**. A report carrying
`scenario:verify=0` looks more thorough than one that omits it, so the line actively purchases
confidence — from the reader and from me — that nothing had earned. Omitting it would have left an
obvious hole; including it filled the hole with nothing.

Note also what made it plausible: `scenario:verify` **is** a real gate, it **is** a real script name,
and it exists in nine `package.json` files. Every part of the name checked out. Only the _root
binding_ did not exist, and nothing in the name says where a script lives.

## The tooling was sound; the report was not

Worth stating, because the instinct is to file a defect:

- `pnpm harness:verify` (`scripts/harness/verify-change.mjs:227`) already resolves the correct
  scope's scenario verification via `resolveScenarioVerification`.
- The pre-push hook runs it in full mode, so the gate would have caught this at push regardless.

There was nothing to fix in the repo. The fix is to read `pnpm run` instead of composing a command
from a name that looks right.

## The family it belongs to

Fourth distinct instance of one question — _what does this answer actually mean_ — in a single day:

| the answer                         | what it was reported as    |
| ---------------------------------- | -------------------------- |
| a `cancelled` check-run            | a conclusion (issue #2237) |
| a check set containing one check   | "all passing"              |
| a corpus that included `examples/` | coverage (issue #2227)     |
| **a command that runs nothing**    | **a passing gate**         |

See [[two-disagreeing-measurements-are-one-finding]], [[a-report-states-what-it-could-not-see]],
[[ci-cancelled-reads-as-failed]], [[claimed-without-reading-back]].

## How to apply

- Before quoting a command as a gate, confirm it resolves **where you are running it**. `pnpm run`
  lists what exists; a name existing in some package is not a root binding.
- A gate whose result never changes is not thereby trustworthy — an always-0 line is equally
  consistent with "always passes" and "never runs". Prefer gates you have seen go red.
- Prefer the repo's own aggregate entry point (`pnpm harness:verify`) over a hand-assembled list of
  sub-commands. Hand-assembly is where invented names enter.

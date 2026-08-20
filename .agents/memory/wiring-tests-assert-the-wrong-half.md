# Accepting is not reading — the wiring test that cannot fail on the defect

## STATUS: measured 2026-08-20/21 across three consecutive issues; no rule filed yet

In-repo mirror (memory-mirroring rule). Host mirror: `wiring-tests-assert-the-wrong-half`.

## The shape

Threading a value through layers, the test that is easy to write asserts the RECEIVING side accepts
it. The defect is that the receiving side never reads it. Those look like one claim and are two:

- **accepting is not reading**
- **existing is not producing**
- **being called is not working**

## Measured: three instances, two caught by review rather than by me

| issue                    | what was asserted                                              | what the defect was                                                                 | who caught it           |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| issue #1937              | the helper's return value                                      | `buildAppendSystemPrompt` had one caller of three                                   | me, from the issue text |
| issue #1934 (first cut)  | the mode surfaces ACCEPT every field — a compile-time property | both modes accepted `allowedTools` and read `parseToolList(args.…)`                 | automated PR review     |
| issue #1934 (second cut) | the live re-application METHOD exists                          | nothing could observe what a re-application produced, so a contaminated base passed | automated PR review     |

The second and third happened _after_ I had written the principle into issue #1937's own commit message.
Writing it down did not carry to the next change.

## Why the weak half is the one that gets written

It is derivable from the diff just made: I look at the type I added and assert the type. The strong
assertion needs an observation point that usually does not exist yet, and creating one reads as
scope creep at the moment it is most needed.

## What worked

Three seams were created for exactly this, and each one immediately caught a real defect:

- `buildServeSessionOptions` — serve's options, assertable without starting a server;
- `presetSessionFields` — the fields taken from the preset surface rather than from flags;
- `PermissionEnforcer.currentPermissionRules()` — what a live re-application produced.

The check: **name the observable the defect would change** — what the provider received, what the
built options hold, what the rules became. If nothing can see it, the seam is the work, not a
detour around it.

---
title: 'HARNESS-059: 67 of 82 catalogued mistakes have no mechanism — the catalogue is a list of things that will happen again'
status: done
completed: 2026-08-04
priority: medium
urgency: soon
type: INFRA
area: .agents/rules, scripts/harness
created: 2026-07-28
depends_on: []
---

# HARNESS-059 — require a mechanism, or an admission that there is none

## Problem

`.agents/rules/common-mistakes.md` holds **82 entries**. Only **3** name an enforcing mechanism
inline. Cross-mapping to registered scans raises it to roughly **15**. The remaining **~67 are prose
only** — including every architecture-placement lesson from 2026-07 (#78, #79, #80, #81).

The wider measurement is the same shape: of **292 normative obligations** across the 19 rule
documents, **232 name no mechanism at all**, and exactly **2** were proven to fire by execution.

This item exists because writing a mistake down demonstrably does not stop it. The clearest instance
from this session: an anti-rot firing over a subject it does not govern was fixed in one scan, the
lesson recorded — and the identical bug was written into a new scan hours later by the same author.
Cataloguing is not prevention; it only feels like it.

## Proposed direction

A `mechanism:` field on each entry, whose value is one of:

- a scan / hook / test / CI job that enforces it — checked to exist, and ideally checked to fail;
- a backlog ID that will build one;
- an explicit `none — accepted as recurring`, with the reason.

Then a scan fails on an entry with no field and no linked item. **The third value is the important
one**: it makes "we are choosing to let this recur" a visible decision rather than the default that
happens by omission. Without it the field becomes a box everyone fills with a promise.

Do NOT require a mechanism for every entry. Some mistakes are genuinely judgement, and forcing a
mechanical claim would produce guards that fire on correct work — which is how guards get disabled,
a failure mode this repository has already paid for.

## Done when

- Every entry carries one of the three values, proven RED by adding an entry without one.
- A `mechanism:` naming a scan that does not exist fails, proven RED — otherwise the field is
  satisfied by a mention, which is the defect class this whole audit is about.
- The count of `none — accepted as recurring` entries is visible somewhere a reader will see it. If
  that number is large, that is the finding.

## Implementation (2026-08-04)

`scan-mistake-mechanisms.mjs`, registered. Every one of the **83** entries now carries a
`**Mechanism:**` value, and the scan judges it.

**Two values, and the second is the point.** A registered mechanism, or `none — <reason>`. Written
down, "we are choosing to let this recur" is a decision; omitted, it is the state that happens when
nobody wrote one. The count is printed on EVERY passing run rather than only on failure, because a
finding nobody sees is one nobody acts on:

```
mistake-mechanisms scan passed (83 entr(y/ies); 36 name a mechanism,
47 are ACCEPTED AS RECURRING with a recorded reason). The second number is the debt.
```

**36 and 47 — and the 47 is the finding this item asked to surface.** It is also an honest number
rather than a flattering one: a mechanism was named only where one demonstrably exists, and the rest
say so.

**A named mechanism must EXIST**, across the three namespaces something can be enforced in: a
registered scan, a `lint:<rule>` in the ESLint configuration, a `ci:<job>` declared by a workflow. A
field satisfied by a mention would be the very defect the catalogue is about.

**The checker caught two of my own claims within a minute of being written** — `lint:no-console` and
`lint:@typescript-eslint/no-explicit-any` reported as not existing. Both ARE configured; the rule
reader matched single-quoted names and this repository's configuration is JSON, which double-quotes.
The check firing on correct data, found by running it, and fixed rather than worked around.

**What it deliberately does NOT claim:** that the named scan actually catches that entry. Only that it
exists and runs. Proving the link needs a failing input per entry — real work, and not a reason to
leave the field unchecked in the meantime.

**Done-when, each red-proved against the REAL catalogue**, not a fixture: an added entry with no value
fails as `no-answer`; changing a real mechanism name to one that was never written fails as
`names-a-mechanism-that-does-not-exist`; and the accepted-as-recurring count is on the passing line.

**Not required of every entry**, as the direction insisted: some mistakes are judgement, and forcing a
mechanical claim would produce guards that fire on correct work — which is how guards get disabled.

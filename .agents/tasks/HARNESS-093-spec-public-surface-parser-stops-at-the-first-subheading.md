---
title: 'HARNESS-093: the spec public-surface scan stops counting at the first subheading, so a SPEC that groups its Public API table by section reads as entirely undocumented'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: scripts/harness, packages/*/docs
depends_on: []
---

# HARNESS-093: a check that cannot PASS on correctly-structured input

## Problem

`scripts/harness/check-spec-public-surface.mjs:95-116` walks a SPEC line by line and holds a single
`inPublicApi` flag:

```js
const heading = line.match(HEADING);
if (heading) {
  inPublicApi = PUBLIC_API_HEADING.test(heading[1]);   // /public api/i
  continue;
}
if (!inPublicApi) continue;
```

Any heading that does not itself contain "Public API" turns the flag **off** — including a `###`
subheading _nested inside_ `## Public API Surface`. So a SPEC that groups its public surface into
`### Core`, `### Permissions`, `### Providers` … has **every one of its tables skipped**, and the scan
concludes that none of the package's exports is documented.

Measured on `packages/agent-core/docs/SPEC.md`: the scan reports **147 undocumented runtime exports** and
that number is frozen as the package's baseline in `spec-surface-baseline.json`. The exports are in fact
documented — `TRUST_TO_MODE`, `Robota`, `AbstractAgent` and the rest all have rows — they simply sit under
subheadings. The baseline is almost entirely **phantom debt**.

## Why this matters more than a wrong number

1. **The ratchet fires on the wrong thing.** Because the baseline is a count, adding one genuinely new
   export to `agent-core` trips the scan even when it is documented in the correct table — which is how
   this was found (ARCH-031 added `DEFAULT_BACKGROUND_PERMISSION_POLICY`). The author's only ways out are
   to contort the document, or to regenerate the baseline and bury the signal.
2. **It is the mirror of a check that cannot fail.** A check that cannot PASS on correctly-structured
   input is the same defect wearing the opposite sign: in both cases the result carries no information
   about the thing it names, and in both cases the number it prints gets believed.
3. **It punishes the recommended structure.** `spec-writing-standard` asks for a Public API table; grouping
   a large one by section is the natural way to keep it readable, and it is what the biggest package does.

## What

Make the section test **hierarchical**: once inside a heading that matches `Public API`, stay inside until
a heading of the SAME OR SHALLOWER level appears. A `###` under a matching `##` continues the section; the
next `##` ends it.

Then re-derive every package's baseline and record the drop. Expect `agent-core` to fall from ~147 to a
small number — and whatever remains is real debt that was invisible until now, which is the actual value of
this fix.

## Test Plan

- Red-first: a fixture SPEC with `## Public API Surface` → `### Core` → table. The current parser reports
  the table's identifiers as undocumented; the fixed parser reports them documented.
- A second fixture proving the section still ENDS at the next same-level heading, so the fix does not make
  the scan count tables that are outside the public-surface section.
- Regenerate `spec-surface-baseline.json` in the same change and state the before/after per package.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — a harness-internal scan with no runnable user-facing behavior. Verification evidence
belongs in the Test Plan above.

## Plan

- [ ] Make the section test hierarchical, with the two fixtures above.
- [ ] Re-derive the baselines; report the per-package delta.
- [ ] Remove the temporary standalone table added to `packages/agent-core/docs/SPEC.md` by ARCH-031, which
      exists only so a genuinely new export was visible past this defect.

## Blockers

- None.

## Result

Pending.

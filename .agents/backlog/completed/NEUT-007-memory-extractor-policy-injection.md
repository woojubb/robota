---
title: 'NEUT-007: memory candidate-extractor locale/domain heuristics → injectable policy'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: []
---

# NEUT-007: memory-extractor heuristic policy in the library

## Problem

`agent-framework/src/memory/memory-candidate-extractor.ts:10-19` hardcodes Korean-language trigger regexes
(기억해/앞으로/항상) and a dev-domain `PROJECT_TERMS` list (`repo|build|test|monorepo`) — locale + domain
POLICY inside the neutral library, invisible to `scan-memory-neutrality` (it checks corpus files/long
literals, not regex policy). Load-bearing under SELFHOST-008. (2026-07-24 neutrality audit, delta gap #6.)

## What

Extract the trigger patterns + project-term vocabulary into an injectable extractor policy (constructor
option with the current bilingual/dev set as the DOCUMENTED default supplied by the composition root, or
a defaults-layer export). NEUT-006's prose floor should cover the regex-policy class once this moves.

## Test Plan

Red-first: custom policy injected ⇒ custom triggers honored, defaults absent; default path unchanged.

## Outcome (2026-07-25)

Shipped (red-first): `RegexMemoryCandidateExtractor` now takes a constructor
`IMemoryExtractorPolicy` — `triggers: { pattern, confidence }[]` + `projectTerms` +
`preferenceTerms` regexes. The Korean trigger regexes and dev-domain PROJECT_TERMS moved into the
exported `DEFAULT_MEMORY_EXTRACTOR_POLICY` (the DOCUMENTED bilingual/dev default; behavior
unchanged, incl. 0.9/0.75 confidences). Custom policy REPLACES the defaults (tested: custom
trigger honored, English + Korean defaults absent). Extractor + policy types exported from the
package index so composition roots can inject via the existing
`AutomaticMemoryController.options.extractor` seam. SPEC updated; NEUT-006's floor can now cover
the regex-policy class.

# A `#N` says whether it is an issue or a pull request

## STATUS: owner directive 2026-08-19; rule landed in `.agents/rules/naming-style.md`

In-repo mirror (memory-mirroring rule). Host mirror: `reference-kind-is-named`.

## The directive

> `#` + 숫자 형태로 적을 때 그게 pr인지 이슈인지 알 수 없으므로 항상 이슈인지 pr인지 병기하도록
> 규칙을 업데이트하라

The rule is owned by [`naming-style.md`](../rules/naming-style.md) § "Reference Kind Is Named" and
is **not restated here**. What this file records is the measurement, the design decision it forced,
and the two things that make the rule easy to get wrong.

## Why the count decided the design

Counted over tracked markdown before anything was written: **2,500 `#N` occurrences across 443
files**, of which 552 already carried a qualifier. A flat gate would have been red on arrival across
443 files.

That is the RAW count — every `#N` in tracked markdown. The scan's own baseline is smaller (1,523
across 294 files at the time it was frozen) because the scan excludes what a reader never has to
disambiguate: fenced blocks, link targets, `CHANGELOG.md`, and references that already name a kind.
Compare like with like before concluding the ratchet drifted.

That number is the whole design. A check that is red on arrival gets suppressed rather than obeyed —
this repository has written that sentence into three separate scans and then had to live with the
consequence — so the tree-side check is a **per-file ratchet**: frozen counts may fall, must never
rise, and a fall is re-frozen in the same change.

The commitlint side needed no ratchet, and the reason generalises: **a check that judges the artefact
being WRITTEN is green on arrival by construction.** The history it cannot reach is history nobody
can rewrite anyway. When a new rule has both a tree surface and a write surface, the two need
different enforcement shapes, and the write surface is always the cheap one.

## The exemption that is load-bearing

`Closes #N` is exempt because GitHub parses that exact shape, and
[INFRA-104](../tasks/INFRA-104-promotion-carries-closing-keywords-to-main.md) built the promotion
machinery that carries those keywords to the default branch so a finished issue closes itself.
Requiring a qualifier there would have traded a readability gain for a broken automation — the kind
of trade a new rule makes silently when its author only looks at the surface being improved.

## Two traps, both measured

**A markdown parser's fence rule is not the obvious regex.** The unclosed-fence terminator must be
end of INPUT, `(?![\s\S])`, not `$`: under the `m` flag `$` matches the end of every LINE, so a lazy
body closes the fence on its own first line and the REAL closing fence is then read as an opening
one — hiding every reference after it. Measured on a three-line fixture that reported nothing.

**A count that fell to zero is not a deleted file.** A per-file ratchet that hands its comparator
only the non-zero rows reports a file still in the tree as "frozen, but no longer in the tree", which
sends the reader looking for a deletion that never happened. Pass the full map; write only the
non-zero rows to the baseline.

## The commitlint trap

Two custom rules must be registered as ONE plugin object carrying both rule bodies. Two plugin
ENTRIES makes commitlint load only the last and then refuse the whole config with `Found rules
without implementation: <the first rule>` — a failure that cannot appear until a second custom rule
exists, so it lands on whoever adds one.

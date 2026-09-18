# No new GitHub Issues — the backlog is consolidated 90 → 10 and stays that size

## STATUS: owner directive 2026-09-19

In-repo mirror (memory-mirroring rule). Host mirror: `no-new-github-issues`.

## The directive

> 추가로 이슈를 만드는 것은 지금 여기 하네스에서 보류된 걸로 알고 있는데 … 지금은 새로 만들 때가 아니고
> 기존 이슈에 내용을 추가하거나 아니면은 댓글로 추가하거나 해서 처리 하는 게 맞아 지금은 이슈를 늘릴 때가
> 아니야 지금 100개 정도 있던 이슈를 열 개로 줄여 놓은거라 더 이상 이슈를 늘릴지 마

## How to apply

- Do not open a new Issue, even for a root item an independent review surfaces and says "must be filed".
- Record the finding as a comment on the closest existing umbrella Issue (#1989, #1999, #2138, #2163,
  #2423, #2525, #2664, #2670, #2680, #2726) or extend that Issue's body, and link the comment from the
  spec/Task that owns the discovery.
- The consolidation register lives in each umbrella's body (`robota-90-to-10-register`); the
  Issue ↔ Task boundary is owned by `.agents/rules/backlog-execution.md`.

Origin: five Issues (#2740–#2744) were opened during OBSERVABILITY-1991 on 2026-09-19 and closed the
same hour; their content moved to a comment on #2670.

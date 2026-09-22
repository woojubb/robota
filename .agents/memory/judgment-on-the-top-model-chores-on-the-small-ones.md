# Judgment on the top model, chores on the small ones

**The sentence, because it is the whole entry:**

> Split each step by kind before dispatching: decisions and verdicts to the top model, mechanical procedures to a sonnet subagent, measurements to a haiku subagent.

## Where it was learned, stated

Owner directive, 2026-09-22, verbatim: "너가 지금 fable 5.1 모델을 쓰는데 중요한 판단은 그걸 쓰고 자잘한
일이나 단순한 일들은 하위 모델 에이전트를 사용해서 처리하라". Given during MCP-002, after a day in which the
top model had itself run scans, moved files, re-padded tables and edited projection rows between the
placement decisions it was actually needed for.

## How to apply

- **Top model:** design and scope decisions; reading gate verdicts; verifying and answering reviewer
  findings; edits to § Decision, ADRs, security boundaries; everything said to the owner.
- **sonnet subagent:** multi-step mechanical procedures with a precise spec — checkpoint commit chains,
  parent `Children`/`Tasks` projection rows, SPEC/README sync, scaffolding from an exact criterion,
  issue bookkeeping.
- **haiku subagent:** scans, greps, counts, log collection, result summaries.
- `backlog-gate-guard` and placement reviews remain judgments: keep them on the top model.

This is an explicit owner authorization to delegate through the Agent tool. Session memory:
`delegate-simple-work-to-lower-models`.

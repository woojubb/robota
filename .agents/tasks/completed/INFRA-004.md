# INFRA-004 Tasks

Spec: `.agents/spec-docs/todo/INFRA-004-agent-core-spec-role-based-refs.md`

## Tasks

- [x] TC-01: `packages/agent-core/docs/SPEC.md` — "Consumed By" 섹션(§842-845)에서 specific consumer-package 이름(`agent-session`, `agent-tools`, `agent-team`, `agent-plugin-*`)을 모두 제거하고 role-based 설명으로 교체. `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md`이 consumer 참조를 반환하지 않도록 한다 (self-reference만 허용).
- [x] TC-02: `packages/agent-core/docs/SPEC.md` — Layer diagram(§49-53)을 role-based 설명("session-layer consumers", "tool-layer consumers", "plugin extensions")으로 재작성하고 phantom `agent-team` / `agent-plugin-*` 이름 제거. `pnpm harness:scan`이 exit 0으로 통과하는지 확인한다.

## Test Plan

Both criteria are command-form smoke checks over a doc-only change to `packages/agent-core/docs/SPEC.md`.

| TC-ID | Test Type              | Tool / Approach                                    | Notes                            |
| ----- | ---------------------- | -------------------------------------------------- | -------------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertion over `agent-core/docs/SPEC.md` | Command-form: zero consumer refs |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                         | doc-only change                  |

TC-01 is verified by running the `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md` assertion and confirming no consumer-package references remain. TC-02 is verified by running `pnpm harness:scan` and confirming exit code 0 after the role-based rewrite of the Consumed By section and Layer diagram.

## Result

Rewrote 17 consumer-package references in `packages/agent-core/docs/SPEC.md` to role-based language
("the session layer", "the tools layer", "the MCP-tool layer", "external plugin packages",
"the multi-agent/orchestration layer"); removed phantom `agent-team` / `agent-plugin-*` names.
Non-core `@robota-sdk/agent-*` references → zero. `pnpm harness:scan` → 23/23 exit 0.
`harness:conformance` violations 100 → 99. Resolves AF-01.

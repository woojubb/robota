# 타입 소유권 인벤토리 (SSOT 감사)

## 범위
- `packages/agents`
- `packages/workflow`
- `packages/team`
- `packages/openai`, `packages/anthropic`, `packages/google`, `packages/remote`, `packages/sessions`
- `apps/web`, `apps/api-server`, `apps/playground`

## owner 축 및 public entry
| owner 패키지 | 소유 축(요약) | public entry |
| --- | --- | --- |
| `@robota-sdk/agents` | event axis, tool axis, message axis, value axis | `packages/agents/src/index.ts` |
| `@robota-sdk/workflow` | workflow graph axis | `packages/workflow/src/index.ts` |
| 기타 패키지 | owner 타입 소비 전용 | 각 패키지 `src/index.ts` |

## 감사 기준
- 동일 의미 타입의 재선언 금지
- 의미 없는 alias 금지
- services/managers/plugins 레이어의 contract 타입 재-export 금지
- 로컬 문자열 유니온 → owner 타입 import로 수렴

## 검사 패턴(핵심)
- `ToolCallData`, `ToolCallPayload`, `ToolCallResult`
- `ToolResultData`, `ToolParameterValue`
- `WorkflowNode*`, `WorkflowEdge*`
- `Message*`, `Conversation*`

## 결과(요약)
- 주요 중복 패턴 미발견(코드 기준)
- 데이터/백업 JSON 파일은 감사 대상에서 제외

## 기록
- 기준일: 2026-02-07

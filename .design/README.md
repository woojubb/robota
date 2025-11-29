# Design 문서 가이드

> Robota SDK의 설계/계획 문서는 모두 `.design/` 폴더에 보관되며, 실행 계획은 `open-tasks/CURRENT-TASKS.md`가 단일 소스입니다. 이 파일은 폴더 구조와 사용 방법만 간략히 안내합니다.

## 1. 단일 소스 정책
- ✅ **진행 중/예정 작업**: `open-tasks/CURRENT-TASKS.md`
- ✅ **Path-Only/이벤트 규칙 요약**: `event-system/` 폴더
- ✅ **Playground/Remote/Planning 개요**: 각 폴더의 개요 문서
- ❌ 과거 상세 체크리스트는 모두 개요 형태로 축약되었고, 중복 계획은 CURRENT-TASKS에서만 관리합니다.

## 2. 주요 폴더 요약
| 폴더 | 설명 |
| --- | --- |
| `event-system/` | Path-Only 스펙, Fork/Join 규칙, Agent 이벤트 정규화, Scenario Recorder 설계 등 실시간 워크플로우 규칙 요약 |
| `open-tasks/` | CURRENT-TASKS 및 히스토리 아카이브. 진행 중인 모든 태스크는 여기에서 관리 |
| `planning/` | Planner/Tool/Module 로드맵의 고수준 개요 (세부 일정은 CURRENT-TASKS에 추가 시 진행) |
| `remote/` | Remote Executor/Provider 전략 요약. 실제 우선순위는 CURRENT-TASKS Priority 0/1 참조 |
| `web/` | Playground/Pricing 등 웹 관련 설계 개요. Priority 3/4와 연결 |
| `robota-saas-website/` | SaaS 전반의 참고 메모 (실제 TODO는 CURRENT-TASKS 우선) |
| `worker/`, `ui/`, `plugin-module-separation/` 등 | 각 분야별 개요 문서. 세부 실행 계획이 필요하면 CURRENT-TASKS에 신규 Priority 항목을 작성 |

## 3. 문서 작성 규칙
1. **한국어 작성** (코드/주석 제외)
2. **개요 > 상세**: 실행 계획은 CURRENT-TASKS로 이동
3. **중복 금지**: 다른 문서와 동일한 체크리스트를 반복하지 않음
4. **링크 유지**: 개요 문서에서 CURRENT-TASKS 또는 관련 스펙 문서로 링크/언급
5. **Deprecated 표기**: 사용하지 않는 문서는 파일 상단에 설명을 추가하고 아카이브 상태를 명시

## 4. 신규 문서 작성 절차
1. CURRENT-TASKS에 Priority/Task를 먼저 추가
2. 필요한 경우 해당 분야 폴더에 “개요/아카이브” 형태의 문서를 작성하여 배경만 정리
3. 작업 완료 후 CURRENT-TASKS에서 `[x]` 표시 및 요약을 남긴다

이 가이드를 기준으로 `.design/` 폴더를 관리해 주세요.

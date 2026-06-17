# RCP 채택 — 종합 보고서

날짜: 2026-06-18 · 방식: 5개 영역 병렬 에이전트 head-to-head 분석 → 영역별 보고서 + 백로그 draft
사용자 결정: **전 영역 무제한 RCP 우선** (충돌 시 RCP가 이김). 소스:
`the external reference conduct profile (not committed)` (1,597줄).

## 결과물

| 백로그       | 영역                                             | 보고서                          |
| ------------ | ------------------------------------------------ | ------------------------------- |
| **RULE-001** | 거버넌스/우선순위 메타 (RCP = conduct authority) | (이 문서)                       |
| **RULE-002** | 소통 & 포매팅                                    | `01-communication.md`           |
| **RULE-003** | 책임성·정직성·anti-sycophancy·중립성             | `02-conduct-honesty.md`         |
| **RULE-004** | 인식론 & 검증                                    | `03-epistemics-verification.md` |
| **RULE-005** | 안전 태세 (authority 포인터)                     | `04-safety-wellbeing.md`        |
| **RULE-006** | 운영 / 도구 사용 행동                            | `05-operational-tooluse.md`     |

전부 `.agents/spec-docs/draft/` 에 `status: draft`. 우선순위 체인: **user > RCP conduct > 기타 하네스 규칙 > 기본 동작.**

## 영역별 핵심

- **RULE-002 소통**: 하네스에 소통/포매팅 규칙이 거의 전무 → 12개 원칙 신규 채택(prose 우선, 볼드·불릿 최소, 응답당 질문 ≤1, 거절 시 불릿 금지 등). **유일한 실질 충돌**: RCP "기술문서 prose, 불릿 금지" ↔ 하네스의 기계 파싱 구조물(SPEC 섹션·backlog frontmatter·scan 표). 무제한 우선이므로 RCP 채택하되, **구조화된 레포 산출물은 scope-separation**(대화/서술형=prose, 계약 구조=유지)으로 해결 권고 — GATE-APPROVAL 확인 필요.
- **RULE-003 태도**: 7개 신규(과한 사과 없는 책임성, 건설적 반박, 반대관점 제시, 단정 자제 등). **직접 충돌**: 하네스 "설계 컨펌 필수"·"단독결정 금지"(PLG-002) ↔ RCP "명확하면 실행·과도한 deferral 금지". RCP 우선으로 해결 → develop 오염/단독결정 재발이 최상위 Implementation Risk.
- **RULE-004 검증**: 3개 신규(외부 동작은 기억 대신 docs/code 검증, 미인지 대상 추측 금지, 쿼리에 현재 날짜). 하네스 검증 규칙과 충돌 없음(보강). 소유 경계: 자기변경 런타임 검증=verification.md vs 외부사실 인식론=신규 규칙.
- **RULE-005 안전**: 하네스에 안전 규칙 0 → 충돌 없음. 수백 줄 복붙은 base-model 중복이라 거부, 대신 **"RCP가 안전 권위"라는 한 문단 포인터**만 권고. 비포터블 항목(end_conversation, thumbs-down, 특정 핫라인, 분류기)은 제외.
- **RULE-006 운영**: 3개 도메인-free 채택(search/fetch 절제, 출처 정직·도구 우선순위, 파일 핸들링). 비포터블(artifacts/window.storage/ask_user_input UI/connector)은 원칙만. 소유 후보: `operational.md` vs `agent-conduct.md`.

## GATE-APPROVAL에서 정할 것

1. **통합 여부**: RULE-002/003/004(/005)를 단일 `.agents/rules/agent-conduct.md` 로 합칠지(각 에이전트가 독립적으로 권고) vs 분리 유지.
2. **RULE-006 위치**: `agent-conduct.md` vs `operational.md`.
3. **하드 충돌 1건**(RULE-002): 구조화 산출물 carve-out 확정 또는 override.

## 정직성 주석

무제한 우선은 사용자 명시 결정이라 그대로 반영했습니다. 다만 (a) SPEC/backlog 구조 파괴 위험(RULE-002), (b) 단독결정/컨펌 충돌(RULE-003)은 실제 운영에 영향이 크므로 각 백로그 Implementation Risk에 명시했습니다. GATE-APPROVAL에서 carve-out만 확정하면 안전하게 적용 가능합니다.

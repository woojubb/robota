# 재감사 리팩토링 실행 계획 (2026-07-04)

> 입력: `.design/audits/2026-07-04-architecture-re-audit.md` (기각 4건·조건부 2건 제외 전 발견 수용).
> 총 백로그 19개 (P1 7 + P2 10 + P3 2), 웨이브별 initiative base branch 운영.

## 웨이브 구성

```
웨이브 0 (승인/결정, 코드 없음)
  A. CI 변경 승인 (INFRA-026 선행)          ── 게이트 → 웨이브 1의 INFRA-026
  B. 죽은 표면 처분 결정 (ARCH-004 선행)     ── 게이트 → 웨이브 2의 ARCH-004·CORE-025·DOCS-020
  C. no-floating-promises 린트 승인          ── 게이트 → 웨이브 2의 CORE-026 (린트 부분만)

웨이브 1 (P1): INFRA-026, HARNESS-022 (→웨이브 2 게이트), CORE-018 (→CORE-023 게이트),
             CORE-022 (→CLI-075 게이트), CORE-019/020/021 (독립 병렬)
웨이브 2 (P2): ARCH-004→DOCS-020, CORE-023/024/025/026, CLI-075, TYPE-003,
             HARNESS-023/024, REFACTOR-025
웨이브 3 (P3): HARNESS-025, INFRA-027 (+Low 잔여는 해당 모듈 백로그에 동반 처리)
```

핵심 게이트 논리: INFRA-026+HARNESS-022가 배선·보강된 뒤에야 죽은 표면 재측정·문서 정합·"재수출 0" 재판정이 신뢰 가능. CORE-018(signal 계약) 없이는 CORE-023(킬 헬퍼)이 전파할 신호가 없음. ARCH-004(처분) 없이는 DOCS-020 수정 범위 미확정.

## 백로그 목록

| ID           | 제목                                                           | 흡수 발견                                                    | 규모 | 선행                    | 사전 승인               | User Execution                                          |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------ | ---- | ----------------------- | ----------------------- | ------------------------------------------------------- |
| INFRA-026    | develop-PR CI에 harness:scan 배선 + pre-push 전체 스위트       | GATE-001/002                                                 | S    | 안건2 승인              | 필요(.github/workflows) | 위반 fixture PR로 CI red→green 실측                     |
| HARNESS-022  | 스캔 사각 3종 보강 + CONTRACT-013 잔존 3종 제거                | CONTRACT-014, STRUCT-02/03, CONTRACT-013                     | M    | 없음                    | 불필요                  | 위반 fixture 3종 fail 실측                              |
| CORE-018     | 취소 계약: IToolExecutionContext signal + runStream threading  | RUNTIME-06/07 (03/23/37 뿌리)                                | L    | SPEC 선행               | 불필요                  | 라이브 스트리밍 중 abort → 도구 즉시 중단 실측          |
| CORE-019     | 컴팩션 실패 원본 보존 + 에러 전파 (비원자 write 포함)          | RUNTIME-15/45                                                | M    | 없음                    | 불필요                  | 실패 주입 후 히스토리 무손상 실측                       |
| CORE-020     | 도구 에러 구조화(error 필드) + IME 휴리스틱 삼킴 제거          | RUNTIME-08/34                                                | M    | 없음                    | 불필요                  | 라이브 headless 실패 도구 → error 필드+종료코드 실측    |
| CORE-021     | EventEmitterPlugin flush 부동 프라미스/catchErrors 수정        | RUNTIME-11                                                   | S    | 없음                    | 불필요                  | 오류 주입 라이브 → unhandled rejection 0 실측           |
| CORE-022     | dispose 체인 단일 계약(shutdown→destroy→plugin)+destroyed 가드 | RUNTIME-09/10/22                                             | L    | SPEC 선행               | 불필요                  | shutdown 후 활성 핸들 0 + 파괴된 에이전트 run 거부 실측 |
| CORE-023     | 공용 킬 헬퍼(SIGKILL 에스컬레이션+프로세스그룹) 5지점 수렴     | RUNTIME-01~05/55                                             | M    | CORE-018                | 불필요                  | 취소 후 ps 프로세스그룹 잔존 0 실측                     |
| CORE-024     | 백그라운드 스케줄러 위생(슬롯/기아/wakeTaskIds/IPC flush)      | RUNTIME-17~20/25                                             | M    | 없음                    | 불필요                  | 라이브 스케줄 태스크 usage 집계 실측                    |
| ARCH-004     | 죽은 표면 처분 집행(결정대로) + 그 위 RUNTIME 결함 동반        | CONTRACT-005/006/007/015/016, RUNTIME-13/14/38/54, STRUCT-07 | L    | 안건1 결정, HARNESS-022 | 불필요                  | 삭제: grep 잔존 0. 배선: 소비 경로 라이브 1회           |
| CORE-025     | permissionPolicy 처분(집행 구현 or 삭제)                       | CONTRACT-004                                                 | M    | 안건1 결정, SPEC 선행   | 불필요                  | 집행 시 정책 위반 라이브 거부 실측                      |
| TYPE-003     | 타입 SSOT 수렴(usage 트리플/status union/미러 → 파생)          | CONTRACT-002/003/011/012/024, RUNTIME-47                     | M    | SPEC 선행               | 불필요                  | 라이브 1회 usage 값 소스·집계 동일 실측                 |
| DOCS-020     | 문서/SPEC 정합 배치                                            | DOCS-1~7, CONTRACT-008/009/010/017/018/019/020               | M    | HARNESS-022, ARCH-004   | 불필요                  | N/A(prose) — 스캔 green + 구식 API grep 0               |
| CORE-026     | 부동 프라미스/레이스 잔여 + (승인 시) 린트 활성화              | RUNTIME-12/21/24/26/36                                       | M    | 안건3 결정, CORE-018    | 린트 부분만             | headless 종료코드 계약 실측                             |
| CLI-075      | 종료/채널 위생(stdin/리스너 13종/permission drain/graceful)    | RUNTIME-31/32/33/35                                          | M    | CORE-022                | 불필요                  | TUI 기동→종료 후 핸들 잔존 0 실측                       |
| HARNESS-023  | 릴리스 게이트 스캔 15종 fixture 테스트                         | GATE-003                                                     | M    | 없음                    | 불필요                  | 위반 fixture fail 실측                                  |
| HARNESS-024  | env-gated 라이브 스모크 1콜 + 로컬/CI 정렬                     | GATE-005/006                                                 | S    | INFRA-026               | 필요(CI job)            | 키 존재 시 실호출 성공/부재 시 skip 실측                |
| REFACTOR-025 | 300줄 상위 3개(828/719/597) 분할 + 스캔 exitCode=1             | STRUCT-01                                                    | L    | INFRA-026               | 불필요                  | 분할 경로 라이브 동작 동일성 + 스캔 전환 실측           |
| HARNESS-025  | P3 게이트 위생(MOCK allowlist/실 sleep/env 변이/PTY HOME)      | GATE-004/007/008/009                                         | M    | HARNESS-023             | 불필요                  | 격리 실행 재현성                                        |
| INFRA-027    | 구조 위생 잔여(중복 선언/devDep 역참조/examples/표기)          | STRUCT-04/05/06/09                                           | S    | HARNESS-022             | 불필요                  | N/A — build:deps+scan green                             |

CONTRACT-022/023 + RUNTIME Low 잔여(28/29/30/39/41~53)는 독립 백로그 없이 해당 모듈 백로그의 동반 처리 항목.

## 사용자 결정 안건

### 안건 1 — [결정 반영됨] 죽은 표면 → 선행 제공 표면 재정의 (2026-07-04 사용자 원칙)

사용자 결정: "라이브러리/프레임워크에서 레포 내 소비 0은 죽음의 증거가 아니다 — 미래 사용을
위한 선행 제공 가정이 필요하다." 이에 따라 아래 옵션표는 폐기되고 ARCH-004는 **표면 유지 +
하드닝**(그 위의 버그 무조건 수정, SPEC/테스트/문서 1급 정비)으로 재스코프됐다. HARNESS-022의
orphan-export 확장도 제외(라이브러리 공개 표면에 구조적 오탐). 규칙 SSOT:
project-structure.md § Forward-Provisioned Surface Rule.

#### (폐기된 원안) 죽은 표면 처분 옵션표

| 표면                             | 추천                       | 근거                                                                                              |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| agent-plugin 전체(76 export)     | 배선 검토 → 미채택 시 삭제 | plugin/event 조립 아키텍처 명시 원칙 — 로드맵 자산 가능성; 배선 계획 없으면 미배포 원칙상 삭제    |
| transport-http/-mcp              | 삭제                       | TRANS-001(payload-agnostic)이 후속 방향으로 존재 — 전세대 유지 근거 없음; RUNTIME-38/54 자동 소멸 |
| 모델 가격표                      | 배선                       | 비용 표시 기능(PM-025 계보)이 소비처 후보로 명확; 가격 신선도 부담 수용 필요                      |
| stateless-runtime                | 삭제                       | dependents 0 + 대체 경로 존재, 배선 시나리오 부재                                                 |
| framework ./testing pass-through | 삭제                       | 재수출 금지 규칙 위반 — 배선 옵션 자체 없음                                                       |
| permissionPolicy 필드            | 배선(집행 구현)            | PRESET-004가 permission profile 계약화 — 삭제 시 preset 권한 모델 붕괴                            |

### 안건 2 — CI 워크플로 변경 (INFRA-026/HARNESS-024)

권고: 승인. 45종 스캔이 병합 경로에 없어 게이트 사각 부류 전체가 통과 중 — 배선 1건으로 부류 회귀 기계 차단(지렛대 ①). 승인 전 착수 금지.

### 안건 3 — no-floating-promises 린트

권고: 승인(error, 기존 위반 소진 후 활성화). T4 군집 9건이 전부 동형 — 린트만이 부류 차단. 미승인 시 CORE-026은 개별 수리만.

## 리스크와 순서 근거

스캔 사각이 메워지기 전의 문서·죽은 표면 작업은 판정 자체가 오염되므로 INFRA-026+HARNESS-022가 선두. CORE-018/022는 공개 계약 변경이라 SPEC 게이트 선행. 죽은 표면 처분은 제품 방향이라 사용자 결정 필수 — 지연 시 ARCH-004/DOCS-020만 밀리도록 의존 분리. 라이브 User Execution 강제는 mock이 놓친 결함을 라이브만 3회 잡은 전력의 반영. CI 변경(INFRA-026)만 develop 직결 PR로 승인 즉시 단독 최우선 처리.

# 아키텍처 재감사 종합 보고서 (2026-07-04, develop, INFRA-024/025 직후)

> 파이프라인: 4차원 병렬 감사(구조/계약/런타임/품질게이트) + 문서 하위 감사 → synthesizer 종합.
> 원 보고 100항목 → 병합 후 P1 7건(지렛대 3), P2 11건, P3 5묶음, 기각 4건·조건부 2건.
> 산출 세션: https://claude.ai/code/session_011yQqJVbCccN9MUypu38mXj

## 요약

INFRA-024/025가 겨냥한 3축(의존 kind, 계약 역수입, preset 문서)은 재발 0으로 실측되어 구조 SSOT 이관 자체는 건전하다(계약 export 127종 중 124종 실소비). 그러나 5개 차원이 독립적으로 동일한 뿌리를 가리킨다: **강제 장치가 선언만 되고 배선되지 않았다** — 45종 스캔이 develop CI에 없고, 스캔 자체의 사각(type-export/배럴/prose)이 이번 감사의 죽은 표면·문서 허위 발견 전부를 통과시켰다. 최대 실사용자 리스크는 런타임 취소/종료 체인의 구조적 붕괴(AbortSignal 미전파, dispose 미호출, 에러의 응답 텍스트화, 컴팩션 실패 시 히스토리 비가역 파괴)로, 공개 API 수준에서 취소 불가·조용한 오답·데이터 오염이 가능하다. P1은 7건이며 그중 3건은 "하나를 고치면 부류 전체가 기계적으로 차단되는" 지렛대다.

## 상위 테마 (교차 차원)

| #   | 테마                                       | 근거 차원                                                                      | 공통 뿌리                                                                                                                                                                                                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 게이트 사각지대 — 규칙은 선언, 강제는 부분 | GATE-001/002/003/005, STRUCT-01/02/03, CONTRACT-014, DOCS 전건                 | 45종 스캔이 develop 병합 경로에 없고, 스캔 자체가 자기 테스트 부재 + 커버리지 구멍(type-export·배럴·서브패스·prose). 실증: STRUCT가 스캔으로 "재수출 0" 측정 ↔ CONTRACT-013 수동 발견 3종 모순 — framework index:507 export type 잔존 확인. |
| T2  | 킬/abort/dispose 체인 붕괴                 | RUNTIME-01~10, 22~24, 32~37, 55                                                | AbortSignal이 도구 실행 계층(IToolExecutionContext)에 구조적으로 부재; SIGKILL 에스컬레이션·프로세스그룹 kill·플러그인 dispose가 각 층에서 독립 누락 — 취소/종료가 계약에 없는 설계 공백.                                                   |
| T3  | 죽은 표면 + 그 위의 문서 허위 안내         | CONTRACT-004~007, 013, 015, 016, 020, STRUCT-07, DOCS-1~7, RUNTIME-13/14/38/54 | dependents 0인 패키지/모듈/필드가 SPEC·README·content/에서 주 API로 안내됨. no-deprecated 규칙상 삭제/배선 양자택일이 선행돼야 문서 수정 범위 확정.                                                                                         |
| T4  | 부동 프라미스/레이스 군집                  | RUNTIME-11, 12, 14, 17, 18, 21, 24, 26, 36                                     | .catch 부재 + await 이전 플래그 설정 반복. no-floating-promises 린트로 부류 차단 가능(신규 린트 정책 = 사전 승인 대상).                                                                                                                     |
| T5  | 타입 수동 미러 (SSOT 위반 잔재)            | CONTRACT-002, 003, 011, 012, 024, RUNTIME-47                                   | usage 트리플 3종+인라인 4곳, status union 이중, 20필드 수동 미러 — RUNTIME-47은 중복이 런타임 결함으로 전이된 사례.                                                                                                                         |

## P1 — 즉시 (7건, 지렛대 3)

1. [GATE-001+002 ≡ HARNESS-021 동형] High — 45종 스캔이 develop-PR CI에 없고 pre-push는 하네스 테스트 29개 중 11개 하드코딩 목록만 실행. 권고: CI quality 잡에 pnpm harness:scan 추가 + pre-push를 전체 스위트로 교체. (지렛대 ①: T1 부류 회귀 기계 차단)
2. [CONTRACT-014+STRUCT-02+03+CONTRACT-013] Medium→High 상향 — orphan-exports가 export type 전체+배럴 스킵, dep-kind가 서브패스·export…from 미매칭, 방향 스캔이 dependencies만 검사 → 죽은 표면 발견 전부(framework 98종, core 39종) 스캔 통과. 사각의 실피해가 본 감사에서 실증. 권고: 3개 스캔 패턴 확장(위반 fixture 동반) 후 CONTRACT-013 잔존 3종 제거. (지렛대 ②)
3. [RUNTIME-06+07] High — IToolExecutionContext에 signal 부재 + runStream signal 2개 층 유실 → 공개 스트리밍 API 취소 불가, Shell 120s/MCP 30s 중단 불능. RUNTIME-03/23/37의 공통 뿌리. 권고: 계약에 signal 추가 + threading (SPEC 선행). (지렛대 ③)
4. [RUNTIME-15] High — 컴팩션 실패 시 전체 히스토리를 '(compaction failed)' 마커로 비가역 치환 후 계속 진행 — append-only/No-Fallback 동시 위반 데이터 오염. RUNTIME-45(비원자 write) 흡수. 권고: 실패 시 원본 보존 + 에러 전파.
5. [RUNTIME-08 (+34)] High(단서: success:false는 설정됨 — response 텍스트 소비 경로에 한정 유효) — 실행 에러가 response 문자열로 반환, error 필드 부재. bin.ts IME 휴리스틱의 headless 크래시 삼킴(34) 동반 수정.
6. [RUNTIME-11] High — EventEmitterPlugin flush 부동 프라미스 + catchErrors 무시 rethrow → unhandled rejection 프로세스 사망 가능.
7. [RUNTIME-09+10+22] High — dispose 체인 3개 층 단절: Robota.destroy가 플러그인 미dispose(usage setInterval 생존), Session.shutdown이 destroy 미호출(저장소 전체 호출 0건 실측), destroyed 플래그 부재로 파괴된 에이전트 부활. 권고: shutdown→destroy→plugin dispose 단일 계약 확정(스펙 선행).

## P2 — 단기 (11건)

8. [RUNTIME-01~05+55] High→Medium(순서 사유) — 킬 에스컬레이션 5개 지점 각각 누락 → 공용 kill 유틸 1개로 일괄 수렴 (P1-3 이후).
9. [RUNTIME-19+20+25+17+18+47] Medium — 백그라운드 스케줄러 위생(잠자는 cron의 슬롯 영구 점유, hung fire 기아, wakeTaskIds 미정리, IPC flush 레이스로 성공이 crash 오보+usage 유실).
10. [CONTRACT-005/006/007/015/016 + RUNTIME-13/14/38/54] High→Medium — 죽은 표면 처분: agent-plugin 전체(76 export)·transport-http/-mcp·모델 가격표·stateless-runtime·전세대 transport 표면 dependents 0. 표면별 삭제 vs 배선은 사용자 결정 안건(제품 방향). 그 위의 런타임 버그(WS stop 행, HTTP 리스너 누수)는 처분에 종속.
11. [CONTRACT-004] High→Medium — permissionPolicy 죽은 필수 필드(쓰기 전부 'inherit-allowlist' 리터럴, 읽기 0곳). 집행 구현 or 삭제 — 스펙 확정 선행.
12. [CONTRACT-002/003/011/012/024 + STRUCT-04] Medium — 타입 SSOT 수렴(usage 트리플, status union, 20필드 미러 → extends/Pick/Omit 파생).
13. [DOCS-1~7 + CONTRACT-008/009/010/017/018/019/020] High→Medium(전부 prose 레벨; P1-2 선행 필요) — 문서/SPEC 정합 배치 수정(SPEC 자기모순, 오귀속, 미수출 createSession·부재 SessionManager 안내, 허위 재수출 주장).
14. [GATE-003] Medium — 릴리스 게이트 스캔 15종 자체 테스트 전무 → publish-safety·release-governance부터 위반 fixture.
15. [GATE-006+005] Medium — 프로바이더 경계 전부 mock + 로컬/CI 불일치 → env-gated 라이브 스모크 1콜 + pre-push 정렬.
16. [STRUCT-01] Medium — 300줄 규칙 경고 전용, 위반 84건(최대 828줄) → 상위 분할 후 exitCode=1 (CLI-BL-022 승격).
17. [RUNTIME-12/21/24/26/36] Medium — 부동 프라미스/레이스 잔여(이중 시작 레이스, 큐 웨징, abortController 레이스, headless 종료코드 계약 붕괴). no-floating-promises 린트는 사전 승인 안건.
18. [RUNTIME-31/32/33/35] Medium — 종료/채널 위생(stdin 미close, TUI 리스너 13종 미해제, permission 큐 미drain, graceful shutdown 공백).

## P3 — 정리 (5묶음)

- GATE-007/008/009: MOCK-001 allowlist 36파일, 실 sleep 의존, env 직접 변이.
- GATE-004(하향): PTY e2e temp HOME 주입.
- STRUCT-04/05/06/09: deps 중복 선언, transport→command devDep 역참조, 부패한 패키지 내부 examples/, 문서 괄호 표기.
- STRUCT-07: framework ./testing pass-through — P2-10 처분에 편승.
- CONTRACT-022/023 + RUNTIME Low 잔여(28/29/30/39/41~53): 모듈 수정 시 동반 처리.

## 기각/하향

| 항목                                | 처분           | 사유                                                     |
| ----------------------------------- | -------------- | -------------------------------------------------------- |
| CONTRACT-021                        | 기각           | 근거가 "스캔 미완"뿐인 추측 — P1-2 완료 시 기계 판명     |
| STRUCT-08 (@/\* alias)              | 기각           | 위반 실측 0, dep-kind 보강에 위임                        |
| RUNTIME-40 (프로바이더 변조 레이스) | 기각           | 추정 + 재현 근거 미제시                                  |
| RUNTIME-38 (HTTP 크로스톡)          | 조건부 기각    | 추정 + 죽은 표면(P2-10 처분 종속)                        |
| GATE-004                            | Medium→Low     | 이 머신 격리 2/2 통과, 실피해 미관측                     |
| RUNTIME-13/14                       | High→조건부    | 죽은 표면 위 결함 — 처분 결정 종속                       |
| CONTRACT-004                        | High→Medium    | 표현 불능 상태라 조용한 우회 경로 부재                   |
| RUNTIME-08                          | High 유지+단서 | success:false 설정 실측 — response 텍스트 소비 경로 한정 |

## 직전 감사 대비 (재발 0)

INFRA-024/025 표적 3축 재발 0 실측(dep-kind 라이브 위반 0, 계약 역수입 0, preset 드리프트 0); devDeps 포함 순환 0; 미선언 prod 의존 0; 스캔 커버 ts 블록 깨진 import 0; .skip/.todo 0; FIFO tail·retainHistory 격리 건전. 단 "framework 재수출 0"은 스캔 기준 측정이었고 수동 감사가 type-only 재수출 3종 발견 — 스캔 의존 판정은 P1-2 보강 후 재측정 필요.

## 병합 매핑

GATE-001≡HARNESS-021 / CONTRACT-020⊂DOCS-2·4 / CONTRACT-013↔STRUCT 측정 모순은 CONTRACT-014 사각으로 해소 / RUNTIME-09+10+22→dispose 체인 / RUNTIME-01~05+55→킬 헬퍼 / CONTRACT-005~007+015+016+RUNTIME-13·14·38·54→죽은 표면 처분 / DOCS-1~7+CONTRACT-008~010·017~020→문서 정합 배치 / CONTRACT-002·003·011·012·024+RUNTIME-47→타입 SSOT 수렴.

## 후기 (Phase 5 결정 반영, 2026-07-04)

- 사용자 원칙 교정: T3의 "죽은 표면" 프레임 폐기 — 라이브러리 공개 표면은 레포 내 소비 0이어도
  선행 제공물로서 정당(§ Forward-Provisioned Surface Rule 신설). CONTRACT-005/006/007/015/016은
  "처분" 대상이 아니라 "하드닝" 대상으로 재분류되며, 그 위의 RUNTIME-13/14/54(및 재상정된 38)는
  무조건 수정으로 승격된다. CONTRACT-014의 orphan-export 확장 권고는 폐기(구조적 오탐).
- 승인: 계획 전체(웨이브 1 착수), CI 워크플로 변경(안건 2), no-floating-promises 린트(안건 3).

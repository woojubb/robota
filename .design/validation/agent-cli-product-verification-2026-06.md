# agent-cli 제품 검증 리포트 (2026-06)

검증 질문: **"이 프로젝트는 실제로 AI CLI가 될 수 있나? 제대로 작동하는 agent-cli인가?"**

- 검증 대상: `@robota-sdk/agent-cli 3.0.0-beta.73` — 저장소 빌드가 아니라 `pnpm pack` 산출
  tarball을 격리 prefix에 **npm 글로벌 설치한 실제 배포 형태**
- 검증 일자: 2026-06-11
- 환경: macOS (Darwin 25.4.0), Node 22/24 (volta), 격리 HOME (`/tmp` throwaway), 실 Anthropic
  API (claude-sonnet-4-6, 키는 `$ENV:` 참조로만 사용·미출력)
- 방법: 4단계 레벨 검증 계획 중 L0(베이스라인) → L1(provider-free 표면) → L3(실 LLM 스모크)
  완료 + L2 일부(PTY 스모크). L2 본격(mock provider E2E + PTY 하네스)은 신규 코드 필요로
  spec-gate 대기.

## 종합 판정

**조건부 합격 — 핵심은 진짜다.** 실제 LLM을 붙여 "파일을 읽고, 버그를 찾고, 수정하고,
테스트를 돌려 확인"하는 에이전트 루프가 npm 설치본에서 end-to-end로 동작함을 확인했다.
출력 포맷 계약(json/stream-json/bare)과 plan 모드 권한 차단도 실측으로 지켜졌다. TUI는
부팅·렌더·슬래시 자동완성까지 정상이다.

단, **자동화/스크립팅 사용자 관점에서는 미달**이다. print mode에서 세션 resume이 완전히
깨져 있고(critical), provider 인증 실패가 exit 0으로 끝나며(major), `init --yes`가
비대화식에서 동작하지 않는다(major). "한 번 묻고 끝나는 일회성 CLI"로는 합격,
"파이프라인에 끼워 쓰는 에이전트 도구"로는 백로그 CLI-063~066 해소 전까지 불합격.

## Addendum (2026-06-12): critical/major 4건 해소 — 자동화 합격선 도달

CLI-063~066이 spec-gate 파이프라인을 거쳐 수정·머지되었고(develop PR #697~#700), 각
백로그의 User Execution Test Scenario를 실 바이너리 + 실 Anthropic API로 재실측해
evidence를 기록했다 (`.agents/backlog/completed/CLI-063~066`):

| 결함                   | 해소 PR | 재검증 결과                                                                                                                           |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| CLI-063 print resume   | #697    | `-p "Remember 42"` → `-p ... -c`가 정확히 `42` 응답, 세션 파일 1개 (이전: 매번 새 세션)                                               |
| CLI-064 exit code 계약 | #698    | 실 401 → text exit 1 + stderr, json `subtype: error` + `error_code: api_error`; 설정 없음 print → exit 3 (이전: 전부 exit 0/1 뒤섞임) |
| CLI-065 init --yes     | #699    | 비TTY `init --yes` 멱등 완주(exit 0), `--yes` 없으면 질문 명시 에러 exit 1 (이전: TTY 에러 + 엉뚱한 안내)                             |
| CLI-066 zero-config    | #700    | 프로필 없이 `ANTHROPIC_API_KEY`만으로 실 LLM 응답 + 안내 1줄 + 키 미노출 (이전: 거부)                                                 |

이로써 종합 판정의 "불합격" 단서는 해소되었다. 잔여: medium/low 백로그(CLI-067~073),
L2 본격 하네스(spec-gate 대기), CJK(CLI-061/062, 사용자 지시로 제외).

## L0 — 베이스라인 (통과)

| 항목                   | 결과                                                                            |
| ---------------------- | ------------------------------------------------------------------------------- |
| `pnpm harness:scan`    | 21/22 ✓ — 유일 실패 `background-workspace`는 기존 알려진 3건 (HARNESS-011 잔여) |
| `pnpm build` 전체      | ✓                                                                               |
| `pnpm test` 전체 sweep | ✓ exit 0, 실패 0건 (agent-cli 107 tests 포함)                                   |

참고: 빌드 전 스캔에서는 `build-contracts`/`dist`도 실패했으나 stale dist가 원인 — fresh
build 후 통과. 스캔이 빌드 산출물에 의존한다는 운영 특성 확인.

## L1 — provider-free 제품 표면

| 검증 항목                                                                | 결과 | 비고                                                                                                                               |
| ------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm pack` tarball 구성                                                 | ✓    | 93파일, workspace deps 전부 `3.0.0-beta.73` 고정 변환                                                                              |
| npm 글로벌 설치 (격리 prefix)                                            | ✓    | 296 패키지, 레지스트리에서 의존성 해소                                                                                             |
| `--version` / `--help`                                                   | ✓    | exit 0, help 내용 충실                                                                                                             |
| `robota diagnose`                                                        | △    | 6종 체크 동작·네트워크 체크 실측. 단 정확성 결함(CLI-067): 동작 중인 설정 프로필을 "No API key found"로 보고, 이슈 발견에도 exit 0 |
| `robota init --yes` (클린 디렉토리)                                      | ✓    | `.robota/settings.json` + `AGENTS.md` 생성, exit 0                                                                                 |
| `robota init --yes` (기존 파일/.claude 존재)                             | ✗    | `--yes` 무시하고 프롬프트 시도 → 비TTY에서 엉뚱한 API-key 안내와 함께 실패 (CLI-065, SPEC:1021 위반)                               |
| `--configure-provider` 6종 (anthropic/openai/gemini/gemma/qwen/deepseek) | ✓    | 전부 exit 0, settings에 `$ENV:NAME` 참조만 저장 — **평문 키 비저장 확인**                                                          |
| `--api-key-env` 실패 메시지                                              | △    | env 미설정 시 "missing apiKey"로 오진 (CLI-068)                                                                                    |
| 미지 provider 이름                                                       | △    | "missing model"로 오진, exit 1은 정상 (CLI-068)                                                                                    |
| `--reset`                                                                | △    | 설정 삭제 동작하나 help 미기재 + 무확인 삭제 (CLI-070)                                                                             |
| 미지 플래그                                                              | ✓    | 명확한 메시지 + exit 1 (SPEC 일치)                                                                                                 |
| provider 미설정 print mode                                               | ✓    | 6종 설정 명령을 전부 안내하는 우수한 메시지, exit 1                                                                                |
| 손상된 프로젝트 settings.json                                            | ✓    | diagnose가 "invalid JSON" 정확 보고                                                                                                |
| 손상된 사용자 settings.json                                              | ✗    | 무음으로 "설정 없음" 취급 — no-fallback 규칙 위반 클래스 (CLI-069)                                                                 |
| Terminal.app 감지 경고                                                   | ✓    | iTerm2 권고 + headless 대안 안내                                                                                                   |

## L3 — 실 LLM 스모크 (Anthropic, claude-sonnet-4-6)

| 검증 항목                         | 결과           | 증거                                                                                                                                                  |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **버그픽스 태스크 E2E**           | ✓              | `nmae` 오타 픽스처에 `-p` + bypassPermissions: ls→read×2→edit→bash(test) 도구 루프 실행, 파일 실제 수정, `node greet.test.js` PASS, 요약 출력, exit 0 |
| 세션 영속화                       | ✓              | `.robota/sessions/*.json`에 system/user/assistant/tool 메시지 구조 저장                                                                               |
| `-c` (continue) print mode        | ✗ **critical** | "42 기억" 후 `-c` 질의 → 새 세션 생성, 모델이 기억 못함. 세션 파일로 입증 (CLI-063)                                                                   |
| `-r <id>` (resume) print mode     | ✗ **critical** | 유효 ID 해소 후에도 무시·새 세션 생성. 원인: `cli.ts:204` resumeSessionId가 TUI에만 전달 (CLI-063)                                                    |
| env 키 단독 구동                  | ✗              | `ANTHROPIC_API_KEY`만으로 "No provider configuration found" — 제품 자신의 안내문과 모순 (CLI-066)                                                     |
| 잘못된 키 (실 401)                | △              | 에러 메시지는 출력되나 **exit 0** — SPEC:1569(exit 1) 위반 (CLI-064)                                                                                  |
| `--output-format json`            | ✓              | 순수 JSON, keys: type/result/session_id/subtype                                                                                                       |
| `--output-format stream-json`     | ✓              | 유효 NDJSON (stream_event delta + result)                                                                                                             |
| `--bare`                          | ✓              | 원문 텍스트만                                                                                                                                         |
| `--dry-run` (plan mode) read-only | ✓              | 수정 지시에도 파일 해시 불변 — 권한 게이트 실측 통과. 단 거부 설명이 모드명을 "moderate"로 지칭 (CLI-072, 저신뢰)                                     |

## L2 일부 — PTY TUI 스모크 (expect 기반, 본격 하네스는 spec-gate 대기)

| 검증 항목                                                  | 결과                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TUI 부팅 (웰컴 박스, 로고, first-run)                      | ✓                                                                                                      |
| status bar (Idle / git 브랜치 / provider·모델 / context %) | ✓                                                                                                      |
| `/` 슬래시 자동완성 드롭다운 렌더                          | ✓ (/skills /help /agent /permissions /mode /language /background /memory 노출)                         |
| `/exit` 종료                                               | ✗ 의심 — "Shutting down..." 후 EOF 미도달, Ctrl+C 필요 (CLI-071)                                       |
| 합성 입력 자동화                                           | △ — 버스트·50ms/char 모두 paste로 묶임 (`[Pasted text #1]`). 자동화 검증에는 L2 결정적 PTY 하네스 필요 |

## 결함 요약 (전건 백로그 등록 완료)

| 백로그  | 심각도   | 한 줄 요약                                                                |
| ------- | -------- | ------------------------------------------------------------------------- |
| CLI-063 | critical | print mode `-c`/`-r` resume 무음 무시 — 항상 새 세션                      |
| CLI-064 | major    | provider 401 → exit 0 + SPEC exit code 표 자체 모순(존재하지 않는 exit 3) |
| CLI-065 | major    | `init --yes`가 프롬프트 2개 경로에서 무시됨 — CI/비대화식 사용 불가       |
| CLI-066 | major    | 안내문이 약속하는 env 키 단독 구동이 거부됨                               |
| CLI-067 | medium   | diagnose 키 체크가 런타임 해소와 불일치 + 이슈에도 exit 0                 |
| CLI-069 | medium   | 손상 사용자 설정 무음 강등 (no-fallback 위반)                             |
| CLI-071 | medium   | TUI `/exit` 행 걸림 의심 + paste 감지 과민 (PTY 하네스로 확정 필요)       |
| CLI-068 | minor    | configure-provider 실패 메시지 오진                                       |
| CLI-070 | minor    | `--reset` help 미기재·무확인 삭제                                         |
| CLI-072 | minor    | plan 모드 거부 설명의 모드명 오기 (저신뢰)                                |

## 미검증 영역 (잔여 리스크)

- **L2 본격**: 19종 슬래시 커맨드 동작, TUI 멀티턴·권한 승인 UI, mock provider 결정적
  E2E, MCP 실연동(mock-mcp-server 픽스처는 준비됨), 비정상 경로(abort/init-timeout) —
  신규 테스트 코드 필요 → spec-gate 파이프라인 선행
- 30분 내구성/장시간 세션, /compact·/cost 실측 (TUI 입력 자동화에 의존)
- CJK/IME (CLI-061/062 — 사용자 지시로 제외)

## 다음 단계 제안

1. CLI-063~066 (critical/major 4건) 우선 수정 — 자동화 사용성 합격선
2. L2 mock-provider + PTY 하네스 spec 문서 작성 → gate 승인 → 구현 (CLI-071 확정 포함)
3. 수정 후 본 리포트의 ✗ 항목 재검증 (회귀 잠금)

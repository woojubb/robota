# Robota CLI — 완성도 종합 보고서

생성일: 2026-05-24  
버전: `@robota-sdk/agent-cli` v3.0.0-beta.67  
분석 방법: 시니어 개발자(기술) + PM(사용성) 병렬 독립 분석 후 종합

---

## 종합 점수

| 관점                     | 점수          | 한 줄 평가                                          |
| ------------------------ | ------------- | --------------------------------------------------- |
| 기술 완성도 (시니어 Dev) | **7.2 / 10**  | 아키텍처 탁월, 보안·테스트가 안정화 발목            |
| 사용성·실효성 (PM)       | **67 / 100**  | 차별점 명확하나 진입 마찰이 전환을 막음             |
| **종합**                 | **~70 / 100** | 개인 탐색 가능 수준, Product Hunt 런칭은 P0 해결 후 |

---

## 1. 잘 된 것 (유지해야 할 강점)

### 아키텍처 (9.0/10)

```
bin.ts  →  cli.ts (4-레이어 파이프라인)
  Layer 0: Preflight (init/diagnose/help/version)
  Layer 1: IParsedCliArgs → typed option objects
  Layer 2: CommandSetup / ProviderSetup / SessionSetup
  Layer 3: createAgentRuntime (framework delegation)
  Layer 4: runPrintMode | runTuiMode
```

- SPEC.md(1,526줄)가 패키지 소유권을 명확히 정의 — 기여자가 방향을 즉시 파악 가능
- 의존성 방향이 단방향: `agent-cli → agent-framework → agent-session / agent-tools / agent-core`
- `cli-args.ts`: 인자 파싱이 순수 함수 — 부작용 없음, 즉시 throw, 타입 좁히기 명확
- `permission-enforcer.ts`의 "Must NEVER throw" 계약 — API 히스토리 오염 방지

### 권한 시스템

- 3단계 평가: `deny list → allow list → mode policy` — 결정론적
- `plan` 모드: Bash/Write/Edit를 deny — 올바른 read-only 격리
- CLI-030 완료: "이 세션에서 허용" 옵션 (`allow-session`) 추가됨

### 멀티 프로바이더 (핵심 차별점)

- Anthropic, OpenAI, Gemini, Gemma, Qwen, DeepSeek 지원
- `settings.json` 한 줄 변경으로 프로바이더 전환 (`currentProvider: "deepseek"`)
- Claude Code 설정(`.claude/`) 자동 감지 + 마이그레이션 (`robota init`)
- 로컬 모델(LM Studio, Ollama): 인터넷 없는 환경 지원

### 에러 처리 우수 사례

- `web-fetch-tool.ts`의 `classifyFetchError()`: ENOTFOUND/ECONNREFUSED/SSL 등 유형별 메시지 + 재시도 힌트
- `diagnose-command.ts`: 6개 체크 + ✓/⚠/✗ 아이콘 + 해결 링크

---

## 2. 문제 분류 및 우선순위

### P0 — 출시 블로커

| ID      | 제목                                                     | 심각도      | 발견 근거                                                                               |
| ------- | -------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| CLI-035 | Read/Write/Edit 도구 경로 순회(Path Traversal) 보호 없음 | 🔴 CRITICAL | `read-tool.ts`, `write-tool.ts`, `edit-tool.ts` — CWD 범위 검증 전무                    |
| CLI-038 | `cat file \| robota -p "..."` 패턴 동작 안 함            | 🔴 HIGH     | `print-mode.ts` L12-27: positional이 있으면 stdin 무시. README L143에 이 패턴 예시 있음 |
| CLI-040 | TUI 모드 테스트 0개                                      | 🔴 HIGH     | 25개 소스 파일 중 7개만 테스트. 주 사용 경로(`tui-mode.ts`) 전혀 검증 안 됨             |
| CLI-045 | README의 `--model` 플래그가 구현에 없음                  | 🔴 HIGH     | `README.md` L98: `robota --model <model>` 예시. `cli-args.ts`에 해당 옵션 없음          |

### P1 — 안정화 필수

| ID      | 제목                                                               | 심각도    | 발견 근거                                                                                                                       |
| ------- | ------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CLI-036 | Bash 타임아웃 캡 미적용                                            | 🟠 MEDIUM | `bash-tool.ts` L26: "max 600000" 설명이지만 `Math.min` 없음                                                                     |
| CLI-037 | `--api-key` 플래그가 셸 히스토리에 평문 노출                       | 🟠 MEDIUM | `cli-args.ts` L154: 민감 값 플래그에 경고 없음                                                                                  |
| CLI-039 | `init-command.ts` JSON.parse 예외 미처리                           | 🟠 MEDIUM | L52: Claude Code 설정 파일이 손상된 JSON이면 크래시                                                                             |
| CLI-041 | `diagnose`, `init`, `web-fetch`, `web-search` 테스트 없음          | 🟠 MEDIUM | 진단/마이그레이션/네트워크 경로 모두 미검증                                                                                     |
| PM-031  | README에 스크린샷/데모 GIF 없음                                    | 🟠 MEDIUM | 경쟁사(Aider, Claude Code) 모두 데모 GIF 보유                                                                                   |
| PM-032  | `ANTHROPIC_API_KEY` 환경변수 있어도 settings.json 없으면 설정 화면 | 🟠 MEDIUM | CI/Docker에서 마찰. Claude Code는 ENV만으로 즉시 실행                                                                           |
| PM-033  | `robota init` 완료 후 프로바이더 설정 연결 안 됨                   | 🟠 MEDIUM | init 이후 바로 `robota` 실행 → "No provider configuration"                                                                      |
| PM-035  | `diagnose` 커맨드 3가지 약점                                       | 🟠 MEDIUM | DASHSCOPE 누락, 항상 Anthropic만 체크, settings.json 내용 미검증                                                                |
| PM-036  | README 슬래시 커맨드 10개 누락                                     | 🟠 MEDIUM | `/mode`, `/memory`, `/provider`, `/rewind`, `/settings`, `/skills`, `/statusline`, `/background`, `/validate-session`, `/reset` |
| PM-037  | README에 "왜 Robota인가?" + SDK 임베딩 예제 없음                   | 🟠 MEDIUM | 가장 강한 차별점이 README 하단에 묻혀있고 코드 예제도 없음                                                                      |

### P2 — 완성도 향상

| ID      | 제목                                                      | 발견 근거                                                                              |
| ------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| CLI-042 | `grep-tool.ts` 순차 파일 읽기 → 병렬화                    | 파일을 하나씩 읽음. `Promise.all` or `p-limit` 적용 시 대규모 코드베이스에서 수배 속도 |
| CLI-043 | `glob-tool.ts` mtime 조회 N+1                             | 1000개 파일에 1000개 `stat` 시스템 콜 동시 발생 — I/O 폭발 가능                        |
| CLI-044 | `cli.ts` L119 `process.exit(0)` — 비동기 리소스 정리 생략 | TUI 종료 후 `process.exit`가 이벤트 루프 즉시 강제 종료                                |
| CLI-046 | `--denied-tools` 플래그 없음                              | 특정 도구만 제외하거나 도구 없는 순수 대화 모드 실행 불가                              |
| CLI-047 | Print 모드 구조화 exit code 없음                          | API 에러/도구 실패/타임아웃을 CI에서 구분 불가. 현재 모두 `exit(1)`                    |
| CLI-048 | WebSearch가 `BRAVE_API_KEY` 없으면 완전 비활성            | 폴백 없음. README 환경변수 표에도 `BRAVE_API_KEY` 누락                                 |
| PM-034  | `/help` 커맨드에 각 커맨드 예시 없음                      | 설명만 있고 사용 예시(`/compact "keep code"`) 없음                                     |

### P3 — 장기 과제

| ID      | 제목                                     |
| ------- | ---------------------------------------- |
| CLI-032 | git 통합 (`/commit`, `/status`, `/diff`) |
| PM-026  | 공식 GitHub Action                       |
| PM-029  | SDK Starter Kit 레포                     |
| PM-030  | opt-in 익명 텔레메트리                   |
| PM-027  | 한국어 마케팅 콘텐츠                     |
| PM-028  | 베타 초대 프로그램                       |

---

## 3. 경쟁 포지셔닝 분석

### 실제 차별점 (유지/강화 필요)

| 강점                                            | 현재 상태 | 활용 수준                     |
| ----------------------------------------------- | --------- | ----------------------------- |
| 멀티 프로바이더 one-config                      | ✅ 구현됨 | README에 있지만 마케팅 약함   |
| Claude Code 설정 호환 (`.claude/` 마이그레이션) | ✅ 구현됨 | README에 언급 있음            |
| SDK 임베딩 가능 (`@robota-sdk/agent-framework`) | ✅ 구현됨 | README 하단에 묻힘, 예제 없음 |
| 로컬 모델 지원 (LM Studio, Gemma, Qwen)         | ✅ 구현됨 | 설정 파일 예시로만 설명       |
| MIT 오픈소스                                    | ✅        | 언급 있음                     |

### 약점 (경쟁사 대비)

| 약점              | 경쟁사 현황                                    |
| ----------------- | ---------------------------------------------- |
| git 통합 없음     | Aider의 핵심 기능 — 자동 커밋, diff 워크플로우 |
| 데모 GIF 없음     | Claude Code, Aider 모두 보유                   |
| Node 22 진입 장벽 | Claude Code: 제한 없음                         |
| SDK 예제 없음     | 가장 강한 차별점인데 증명 불가                 |

### PMF 결론

현재 포지셔닝 "Claude Code 대안 CLI" → 경쟁 심함(Aider, Cline 동일 포지션)  
**권고 포지셔닝**: "AI 코딩 어시스턴트를 만드는 TypeScript SDK 플랫폼" → 경쟁자 없음

---

## 4. 베타 → 안정화 로드맵

### Phase 1 — Security & Critical Bugs (즉시, 1주)

1. **CLI-035** 경로 순회 방어: `workspace-manifest.ts`의 `validateWorkspaceManifestPath()` 패턴 적용
2. **CLI-038** stdin + positional 동시 처리: `cat file | robota -p "..."` 패턴 지원
3. **CLI-045** `--model` 플래그 구현 또는 README 예시 삭제
4. **CLI-036** Bash 타임아웃 캡: `Math.min(timeout, 600_000)` 한 줄

### Phase 2 — Test & Trust (단기, 2주)

5. **CLI-040** TUI 모드 기본 테스트 5개 이상
6. **CLI-039** `init-command.ts` JSON.parse 보호
7. **PM-035** `diagnose` 커맨드 개선 (DASHSCOPE + 프로바이더별 네트워크 체크 + JSON 검증)
8. **CLI-037** `--api-key` 평문 경고

### Phase 3 — UX & Documentation (중기, 2-4주)

9. **PM-031** README 데모 GIF (asciinema/terminalizer, 2시간 작업)
10. **PM-032** ENV 변수로 settings.json 우회
11. **PM-033** `robota init` → 프로바이더 설정 인라인 연결
12. **PM-036** README 슬래시 커맨드 동기화
13. **PM-037** README "왜 Robota인가?" + SDK 임베딩 예제

### Phase 4 — Performance & Features (GA 전)

14. **CLI-042** grep 병렬화
15. **CLI-047** 구조화 exit code
16. **PM-034** /help 커맨드 예시
17. **CLI-032** git 통합

---

## 5. 이미 완료된 항목 (이번 세션)

이번 검증 직전 세션에서 처리된 항목:

| ID      | 제목                                                | 상태    |
| ------- | --------------------------------------------------- | ------- |
| CLI-027 | `--system-prompt`/`--append-system-prompt` TUI 연결 | ✅ done |
| CLI-028 | Node.js 22 빌드 배너                                | ✅ done |
| CLI-029 | macOS CJK 경고 + IME 핸들러 개선                    | ✅ done |
| CLI-030 | "이 세션에서 허용" 권한 옵션                        | ✅ done |
| CLI-031 | 도구 출력 truncation 경고                           | ✅ done |
| PM-023  | 첫 실행 온보딩 웰컴 배너                            | ✅ done |
| PM-024  | `robota diagnose` 구현 (6개 체크)                   | ✅ done |
| PM-025  | `/cost` 정확도 — 이미 구현됨 확인                   | ✅ done |
| CLI-033 | headless E2E 테스트 10개                            | ✅ done |

---

_본 보고서는 시니어 개발자 에이전트(기술 분석)와 PM 에이전트(사용성 분석)의 독립적 코드 직접 분석 결과를 종합한 것이다._

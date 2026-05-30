# Robota CLI 완성도 검토 — 종합 보고서

> 작성일: 2026-05-23  
> 검토 버전: `3.0.0-beta.67`  
> 원본 보고서: `cli-review-senior-dev.md` (기술 관점) + `cli-review-manager.md` (제품 관점)

---

## 종합 평가

| 관점        | 점수       | 핵심 판단                                        |
| ----------- | ---------- | ------------------------------------------------ |
| 기술 완성도 | 8.0/10     | 아키텍처 탁월, 5~6개 명확한 버그 존재            |
| 제품 완성도 | 6.5/10     | 기능 탄탄하지만 사용자 노출 격차 多              |
| **종합**    | **7.3/10** | 배포 직전 수준 — 사용자 이탈 유발 요소 제거 필요 |

### 강점

- 5레이어 아키텍처 (core → session/provider → framework → command → cli), 의존성 역방향 없음
- TypeScript 100% strict (`any` 없음), Zod 기반 설정 검증
- 21개 슬래시 커맨드, streaming, abort signal, session checkpoint 전 완성
- 멀티 프로바이더 (Anthropic, OpenAI, Gemini, DeepSeek, Qwen, LM Studio)
- SENSITIVE_KEY_PATTERN redact, env-ref 인다이렉션 보안 기본기

### 약점 요약

- 세션 복원 경로에 silent failure 3곳 (corrupt JSON, non-string tool content, compaction fallback)
- Anthropic vision 미구현인데 capability에 선언만 되어있음
- Node.js 22+ 강제로 Node 18/20 LTS 사용자 전면 차단
- 베타 상태가 마케팅/문서 어디에도 명시되지 않음
- 공식 플러그인 README 비어있음, 마켓플레이스 URL 없음

---

## 우선순위별 전체 문제 목록

### 🔴 Critical — 릴리스 차단 (사용 중 데이터 손실 또는 오작동)

| #   | 위치                                                                                    | 문제                                                                                                                            | 영향                  |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| C-1 | `agent-session/src/session-store.ts:119`                                                | `load()` 에서 `JSON.parse` 예외 무처리 — corrupt 세션 파일 시 `--continue`/`--resume` 즉시 crash                                | 사용자 세션 복원 불가 |
| C-2 | `agent-provider/src/anthropic/provider-definition.ts:81` + `message-converter.ts:18-23` | `'vision'` capability 선언되어 있으나 `convertToAnthropicFormat`이 `parts` 배열 무시 — 이미지 조용히 drop                       | 기능 거짓 주장        |
| C-3 | `agent-framework/src/interactive/interactive-session-restore.ts:24`                     | `typeof msg.content !== 'string'` 이면 tool 메시지 조용히 skip — 복원된 세션에서 `tool_use` + `tool_result` 쌍 불완전 → API 400 | 세션 복원 후 crash    |
| C-4 | macOS Terminal.app                                                                      | CJK IME 입력 시 crash — 한국/일본어 사용자 기본 터미널 사용 불가                                                                | 주요 타겟 시장 이탈   |

### 🟠 High — 출시 전 필수

| #    | 위치                                                                    | 문제                                                                                                           | 영향                         |
| ---- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| H-1  | `package.json engines.node`                                             | Node.js `>=22.0.0` 강제 — SDK는 18+를 지원한다고 명시, CLI와 불일치                                            | Node 20 LTS 사용자 전면 차단 |
| H-2  | 마케팅/README                                                           | 베타(`3.0.0-beta.67`) 상태가 `robota.io`, README, 문서 어디에도 명시 없음                                      | 안정성 오해 → 이탈           |
| H-3  | `agent-cli/src/utils/cli-args.ts:75`                                    | `--dry-run <prompt>` help 텍스트가 `<prompt>`를 옵션 인자처럼 묘사, 실제는 positional                          | 사용법 혼란                  |
| H-4  | `agent-framework/src/interactive/interactive-session.ts:288-302`        | `shutdown()` 시 `this.listeners` 미정리 — 긴 세션에서 GC leak 가능                                             | 장기 세션 메모리 누수        |
| H-5  | `agent-framework/src/command-api/provider/provider-settings.ts:158-164` | `--api-key` plain text 저장 경로에 경고 없음                                                                   | 보안 인식 부재               |
| H-6  | `packages/agent-cli/README.md`                                          | 환경 변수 표에 `OPENAI_API_KEY`, `GEMINI_API_KEY` 등 누락                                                      | 온보딩 실패                  |
| H-7  | `content/guide/cli.md`                                                  | `/settings` 커맨드 문서 누락 (`default-command-modules.ts`에는 존재)                                           | 기능 발견 불가               |
| H-8  | `cli-args.ts`                                                           | `--task-file`, `--bare`, `--fork-session`, `--format`, `--summary`, `--source` — `--help`와 문서에 없는 플래그 | 사용 의도 불명확             |
| H-9  | 공식 플러그인 패키지                                                    | `plugin-github/slack/jira/linear/notion` README 비어있음                                                       | 사용 방법 불명               |
| H-10 | 문서                                                                    | 플러그인 마켓플레이스 URL 없음, 실제 운영 여부 불명                                                            | 기능 사용 불가               |
| H-11 | `apps/www/src/app/compare/page.tsx`                                     | 비용 비교 섹션 주석 처리된 채 배포 중                                                                          | 미완성 노출                  |

### 🟡 Medium — 다음 마일스톤

| #   | 위치                                                                     | 문제                                                                            | 영향                     |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------ |
| M-1 | `agent-session/src/session-store.ts:107`                                 | `save()/load()/list()` 동기 I/O — 대용량 세션 시 이벤트 루프 블록               | 응답성 저하              |
| M-2 | `agent-session/src/compaction-orchestrator.ts:92`                        | compaction 실패 시 `'(compaction failed)'` 문자열 대화에 삽입 — silent fallback | AI 혼란 유발             |
| M-3 | `agent-provider/src/shared/openai-compatible/message-converter.ts:33-36` | OpenAI ChatCompletions 경로 vision 미지원 (GPT-4o 등)                           | 기능 갭                  |
| M-4 | `agent-cli` 테스트                                                       | `tui-mode`, `print-mode` 통합 테스트 0개                                        | 회귀 감지 불가           |
| M-5 | `agent-cli/tsup.config.ts`                                               | tsdown 마이그레이션 후 남은 dead artifact                                       | 혼란 유발                |
| M-6 | `agent-session/src/session-store.ts:27-50`                               | `messages`, `history` 등 9개 필드 `unknown[]` — 저장/로드 타입 안전성 부재      | 런타임 오류 가능         |
| M-7 | 문서                                                                     | CI/CD 통합 예제 없음 (GitHub Actions + `robota -p`)                             | 파워 유저 확보 기회 손실 |
| M-8 | `/model` 커맨드                                                          | 프로바이더 전환 시 CLI 재시작으로 세션 히스토리 소실                            | 장기 세션 불편           |

### ⚪ Low — v2 이후

| #   | 문제                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------- |
| L-1 | `agent-session` `PermissionEnforcer`, `CompactionOrchestrator`, `context-window-tracker` 단위 테스트 부족 |
| L-2 | `bin/robota.cjs` git 추적 — 빌드 artifact를 `.gitignore`에 추가 권고                                      |
| L-3 | 엔터프라이즈 설정 레이어 (org-policy.json, RBAC, SSO)                                                     |
| L-4 | VS Code 확장 — 에디터 통합 시장 진입                                                                      |
| L-5 | 프로바이더 핫 스왑 (재시작 없이 동적 전환)                                                                |
| L-6 | 세션별 비용 추적 및 임계값 알림                                                                           |
| L-7 | MCP 서버 TUI 브라우저 (`@robota-sdk/agent-tool-mcp` 기반)                                                 |
| L-8 | Git 커밋 자동화 (Aider 방식)                                                                              |

---

## 생성된 백로그

| 백로그 ID | 제목                                                      | 우선순위 |
| --------- | --------------------------------------------------------- | -------- |
| CLI-013   | SessionStore.load() JSON 파싱 예외 처리                   | critical |
| CLI-014   | Anthropic vision capability 선언-미구현 수정              | critical |
| CLI-015   | 세션 복원 non-string tool 메시지 처리                     | critical |
| CLI-016   | macOS Terminal.app CJK IME 크래시 해결                    | critical |
| CLI-017   | Node.js 요구 사항 20 LTS로 낮추기                         | high     |
| CLI-018   | 베타 상태 명시 (docs + 마케팅)                            | high     |
| CLI-019   | CLI 문서 정리 bundle (env vars + 숨긴 플래그 + /settings) | high     |
| CLI-020   | 공식 플러그인 README + 마켓플레이스 문서                  | high     |
| CLI-021   | CI/CD 통합 예제 문서                                      | high     |
| CLI-022   | 코드 품질 quick-fixes bundle                              | high     |
| CLI-023   | agent-cli tui/print-mode 통합 테스트                      | medium   |
| CLI-024   | OpenAI ChatCompletions vision 지원                        | medium   |
| CLI-025   | 프로바이더 핫 스왑                                        | low      |
| CLI-026   | 엔터프라이즈 설정 레이어                                  | low      |

---

## 로드맵 요약

```
즉시 수정 (이번 스프린트)
  CLI-013  SessionStore crash 방어
  CLI-014  Anthropic vision 거짓 선언 제거
  CLI-015  세션 복원 tool 메시지 fix
  CLI-016  CJK 크래시 (조사 시작)
  CLI-022  quick-fixes bundle

출시 전 (베타 → RC)
  CLI-017  Node 20 지원
  CLI-018  베타 명시
  CLI-019  문서 정리
  CLI-020  플러그인 README
  CLI-021  CI/CD 예제

다음 마일스톤
  CLI-023  통합 테스트
  CLI-024  ChatCompletions vision

장기
  CLI-025  핫 스왑
  CLI-026  엔터프라이즈
```

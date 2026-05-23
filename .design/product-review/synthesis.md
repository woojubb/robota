# robota CLI 제품 개선 종합 분석

> 작성일: 2026-05-23  
> 기반 자료: 시니어 웹 기획자 검토 + 시니어 PM 검토  
> 목적: 두 검토를 통합하여 실행 가능한 우선순위와 백로그 도출

---

## 핵심 진단 요약

두 검토가 공통으로 지적한 단일 최대 문제:

> **"기술은 경쟁력 있다. 그러나 첫 5분 경험이 사용자를 내쫓는다."**

robota는 멀티 프로바이더 지원, 세션 지속성, 백그라운드 에이전트, 스킬 시스템 등 경쟁 제품에 없는 기능을 이미 갖추고 있다. 그러나 설치 직후 사용자가 마주치는 경험(빈 화면, 기술 용어 중심 선택지, API 키 없이는 아무것도 안 됨)이 채택을 막는다.

---

## 두 검토 교차 분석

### 공통으로 지적된 문제 (가중치 2배)

| 문제                            | 웹 기획자 | PM         | 심각도    |
| ------------------------------- | --------- | ---------- | --------- |
| 첫 실행 후 빈 화면, 힌트 없음   | UX-010    | PM-001     | 🔴 치명적 |
| `npx robota` 불가 (긴 패키지명) | MKT-010   | Phase 1 P0 | 🔴 치명적 |
| 공급자 선택 화면 설명 없음      | UX-012    | 장벽 #1    | 🔴 치명적 |
| API 오류 메시지 기술 용어       | UX-011    | 장벽 #3    | 🟠 높음   |
| GitHub Actions 통합 부재        | CLI-011   | PM-016     | 🟠 높음   |
| 비용 추적/가시성 부재           | UX-019    | PM-007     | 🟡 중간   |
| 로컬 LLM 공식 지원 미흡         | SWOT 기회 | PM-011     | 🟡 중간   |

### 웹 기획자가 추가로 발견한 TUI UX 문제

- 컨텍스트 창 컬러 코딩 없음 → UX-015
- `/compact` 후 무음 처리 → UX-016
- 허가 프롬프트 프로젝트 영구 허가 없음 → UX-017
- 세션 이름 UUID → UX-014
- 설정 파일 출처 추적 불가 → UX-013
- 키보드 단축키 인라인 도움말 없음 → UX-018
- `robota init` 프로젝트 초기화 마법사 없음 → CLI-010
- `--dry-run` 실행 전 계획 미리보기 없음 → CLI-012

### PM이 추가로 발견한 제품 전략 문제

- 포지셔닝 메시지 부재 ("왜 써야 하나") → PM-002
- 사용 데이터 전무 (의사결정 기반 없음) → PM-003
- API 키 없이 체험 불가 → PM-004
- 플러그인 생태계 씨앗 없음 → PM-005, PM-012
- 스킬 공유 커뮤니티 없음 → PM-006
- SDK 임베딩 레퍼런스 없음 → PM-008
- 공개 로드맵 없음 → PM-017
- Enterprise 진입로 없음 → PM-015

---

## 핵심 포지셔닝 (두 검토 합의)

```
"The open-source AI coding CLI. Any provider. BYOK."
 오픈소스  ·  어떤 AI도  ·  API 키 직접 관리
```

보조 메시지:

```
"Use it as a CLI. Embed it in your app. Both with the same package."
```

이 포지셔닝은 Claude Code(공급자 고정), Cursor(구독 필수), Aider(Python)가 줄 수 없는 것이다.

---

## 통합 우선순위 매트릭스

### 🔴 P0 — 즉시 (출시 전 블로커)

| ID      | 항목                                       | 임팩트 | 노력 |
| ------- | ------------------------------------------ | ------ | ---- |
| MKT-010 | `npx robota` 단축 실행 (npm 별칭)          | 최고   | 최저 |
| UX-010  | 첫 실행 완료 후 시작 힌트 출력             | 최고   | 낮음 |
| UX-011  | API 오류 메시지 사용자 친화적 변환         | 높음   | 낮음 |
| UX-012  | 공급자 선택 화면 설명·뱃지 추가            | 높음   | 낮음 |
| PM-001  | Onboarding Wizard (키 없이 체험 경로 포함) | 최고   | 중간 |
| PM-002  | Why robota 비교 페이지                     | 높음   | 낮음 |

### 🟠 P1 — 1~2주 내

| ID      | 항목                                       | 임팩트 | 노력 |
| ------- | ------------------------------------------ | ------ | ---- |
| UX-015  | 컨텍스트 창 컬러 코딩 + 임계값 경고        | 높음   | 낮음 |
| UX-017  | 허가 프롬프트 3단계 메모리 (프로젝트 영구) | 높음   | 중간 |
| UX-013  | `/settings active` — 설정 출처 표시        | 높음   | 중간 |
| UX-016  | `/compact` 후 결과 요약 리포트             | 중간   | 낮음 |
| PM-003  | opt-in 익명 텔레메트리                     | 높음   | 중간 |
| PM-004  | `robota demo` — API 키 없이 체험           | 높음   | 중간 |
| CLI-010 | `robota init` 프로젝트 초기화 마법사       | 높음   | 중간 |
| PM-011  | 로컬 LLM (Ollama, LM Studio) 공식 지원     | 높음   | 중간 |

### 🟡 P2 — 1개월 내

| ID      | 항목                                   | 임팩트    | 노력 |
| ------- | -------------------------------------- | --------- | ---- |
| UX-014  | 세션 자동 이름 생성 (AI 요약)          | 중간      | 중간 |
| UX-018  | `?` 키 인라인 단축키 오버레이          | 중간      | 낮음 |
| UX-019  | 실시간 API 비용 추적 + 예산 알림       | 중간-높음 | 중간 |
| CLI-011 | GitHub Actions 공식 Action             | 높음      | 중간 |
| CLI-012 | `--dry-run` 실행 전 계획 미리보기      | 높음      | 중간 |
| PM-005  | 공식 플러그인 스타터 팩 5종            | 높음      | 높음 |
| PM-006  | `robota-skills` 공개 커뮤니티 레포     | 높음      | 낮음 |
| PM-008  | SDK 임베딩 예제 레포 (3종)             | 높음      | 중간 |
| PM-012  | 플러그인 개발 가이드 + 디렉토리 페이지 | 높음      | 중간 |
| PM-010  | Changelog 공개 페이지                  | 중간      | 낮음 |

### 🔵 P3 — 중기 로드맵 (3~6개월)

| ID     | 항목                                  | 임팩트    | 노력 |
| ------ | ------------------------------------- | --------- | ---- |
| PM-007 | AI 비용 계산기 웹 도구                | 중간      | 중간 |
| PM-009 | Product Hunt 런치 플랜                | 최고      | 중간 |
| PM-013 | Show HN + AI 커뮤니티 런치 캠페인     | 높음      | 낮음 |
| PM-015 | Enterprise 문의 채널 + 보안 정책 문서 | 중간-높음 | 낮음 |
| PM-017 | 공개 로드맵 페이지                    | 중간      | 낮음 |
| PM-014 | 사용자 인터뷰 프로그램 (월 5명)       | 높음      | 낮음 |
| PM-018 | 세션 공유 링크 기능                   | 중간      | 높음 |
| PM-019 | 개발자 뉴스레터 게재 신청             | 중간      | 낮음 |
| PM-020 | 온보딩 이탈 지점 Funnel 분석          | 높음      | 낮음 |
| PM-021 | "Build with robota" 쇼케이스 페이지   | 중간      | 낮음 |
| PM-022 | 월간 커뮤니티 콜                      | 중간      | 낮음 |

---

## 즉시 실행 가능한 3가지 (비용 없음, 1시간 내)

1. **README 첫 줄 교체**: `"The open-source AI coding CLI. Any provider. BYOK."` + npm/GitHub 배지 추가
2. **`bin` 필드 확인**: `package.json`의 `bin.robota` 항목이 있는지, `npx robota`가 동작하는지 확인
3. **Why robota 페이지**: 비교표 + 비용 계산기를 robota.io에 단일 페이지로 추가

---

## 생태계 성장 전략 (두 검토 합의)

```
1단계: 사용 가능하게 (온보딩 수술)
2단계: 찾을 수 있게 (포지셔닝 + 커뮤니티 런치)
3단계: 확장 가능하게 (플러그인 + 스킬 생태계)
4단계: 수익화 (Cloud Pro + Enterprise)
```

핵심 원칙: **오픈소스 코어는 영구 무료**, 수익은 Cloud/Enterprise 부가가치 레이어에서만.

---

## 백로그 생성 완료 목록

이 문서를 기반으로 다음 백로그 파일들이 생성되었습니다:

### P0 — 즉시

- `UX-010-first-run-welcome-hint.md`
- `UX-011-api-error-message-humanization.md`
- `UX-012-provider-selection-descriptions.md`
- `MKT-010-npx-robota-shortcut.md`
- `PM-001-onboarding-wizard.md`
- `PM-002-why-robota-comparison-page.md`

### P1 — 1~2주

- `UX-013-settings-active-source-display.md`
- `UX-015-context-usage-color-coding.md`
- `UX-016-compact-result-summary.md`
- `UX-017-permission-prompt-3level-memory.md`
- `PM-003-opt-in-telemetry.md`
- `PM-004-robota-demo-command.md`
- `CLI-010-robota-init-wizard.md`
- `PM-011-local-llm-official-support.md`

### P2 — 1개월

- `UX-014-session-auto-naming.md`
- `UX-018-keyboard-shortcut-overlay.md`
- `UX-019-api-cost-tracking.md`
- `CLI-011-github-actions-official-action.md`
- `CLI-012-dry-run-flag.md`
- `PM-005-official-plugins-starter-pack.md`
- `PM-006-robota-skills-community-repo.md`
- `PM-008-sdk-embedding-examples.md`
- `PM-010-changelog-page.md`
- `PM-012-plugin-dev-guide.md`

### P3 — 중기 로드맵

- `PM-007-ai-cost-calculator.md`
- `PM-009-product-hunt-launch.md`
- `PM-013-show-hn-campaign.md`
- `PM-014-user-interview-program.md`
- `PM-015-enterprise-contact-security.md`
- `PM-017-public-roadmap-page.md`
- `PM-018-session-share-link.md`
- `PM-019-newsletter-outreach.md`
- `PM-020-onboarding-funnel-analysis.md`
- `PM-021-build-with-robota-showcase.md`
- `PM-022-monthly-community-call.md`

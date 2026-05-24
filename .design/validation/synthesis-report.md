# @robota-sdk/agent-cli 검증 종합 보고서

> 작성일: 2026-05-24  
> 기반 보고서: [시니어 개발자 관점](./senior-dev-report.md) + [PM 관점](./pm-report.md)  
> 목적: agent-cli를 실제 개발자들이 쓸 수 있는 도구로 검증하기 위한 통합 판단과 액션 플랜

---

## 1. 핵심 결론 (Executive Summary)

두 관점이 모두 동의하는 최종 판단:

> **"아키텍처는 엔터프라이즈급이나, 사용자가 그 가치에 도달하기 전에 막힌다."**

- **기술 완성도**: A급 설계, B-급 실행
- **채택 준비도 (Adoption Readiness)**: 60/100
- **즉시 실전 투입 가능 여부**: 개인 개발자 탐색용 ✅ | 팀 온보딩 ❌ | 프로덕션 CI ❌ (현재)

두 보고서에서 교차 검증된 가장 중요한 발견은 두 가지다:

1. **진입 장벽이 기술 완성도 문제가 아니라 UX 마찰 문제다.** Node 22, CJK 크래시, 첫 실행 가이던스 부재는 내부 구현 품질과 무관하게 사용자를 첫 5분 안에 잃는 원인이다.

2. **진짜 차별점이 마케팅과 불일치한다.** 현재 "Claude Code 대안 CLI"로 포지셔닝하지만 실제 경쟁 우위는 **SDK 임베딩 플랫폼**이다. 아무도 제공하지 않는 이 차별점을 중심으로 방향을 재설정해야 한다.

---

## 2. 두 관점의 합의 포인트

시니어 개발자(기술)와 PM(제품) 두 관점에서 **모두 동의한 핵심 발견**:

### 블로커 (Blockers)

| #   | 문제                             | 시니어 개발자 판단           | PM 판단                     | 심각도 |
| --- | -------------------------------- | ---------------------------- | --------------------------- | ------ |
| B1  | Node.js 22 강제 요구             | CI 진입 장벽, 기업 환경 차단 | npx 첫 실행에서 상당수 이탈 | P0     |
| B2  | macOS Terminal.app CJK 크래시    | 한국 개발자 타깃에 치명적    | 한/일/중 개발자 전체 이탈   | P0     |
| B3  | `--system-prompt` 미구현         | CI 자동화 가치 30% 손실      | -                           | P1     |
| B4  | 빈 프로젝트 온보딩 가이던스 없음 | -                            | Aha Moment 경로 막힘        | P1     |

### 핵심 갭 (Core Gaps)

| #   | 갭                                          | 양쪽 동의 이유                                          |
| --- | ------------------------------------------- | ------------------------------------------------------- |
| G1  | 비용 추적 불완전                            | 비용 절감이 핵심 가치인데 "/cost"가 "unknown" 표시 가능 |
| G2  | 공식 GitHub Action 없음                     | CI/CD 포지셔닝의 핵심인데 실제 시작 방법이 없음         |
| G3  | SDK 임베딩 예제 부재                        | 최강 차별점인데 5분 안에 경험할 수 없음                 |
| G4  | 플러그인 생태계 = 구조만 있고 플러그인 없음 | "플러그인 시스템" 주장이 설득력 없음                    |
| G5  | 커뮤니티 트랙션 0                           | Showcase 비어있음, 외부 검증 없음                       |

---

## 3. 관점별 고유 발견

### 시니어 개발자만 발견한 기술 문제

| 문제                        | 상세                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Bash 권한 피로              | `default` 모드에서 Bash 실행마다 approve 필요 → 실무에서 모두 `bypassPermissions`로 전환 (더 위험) |
| 도구 출력 30k 자 truncation | 잘릴 때 사용자 알림 없음 → 모델이 불완전한 출력 기반으로 틀린 결론                                 |
| Git 통합 미비               | `/commit`, `/status`, `/diff` 없음 → 코딩 어시스턴트 핵심 워크플로우 약점                          |
| 통합 테스트 4개 파일        | TUI 동작, 권한 플로우, 세션 복원 자동 검증 없음                                                    |
| `/rewind` 미검증            | SPEC에 있지만 멀티파일 원자성 실제 동작 불명확                                                     |

### PM만 발견한 제품 문제

| 문제                     | 상세                                                     |
| ------------------------ | -------------------------------------------------------- |
| 텔레메트리 부재          | 어디서 이탈하는지 데이터 없음 → 제품 개선 가설 검증 불가 |
| 한국어 우선 기회 미활용  | 한국 팀이 만들었는데 GeekNews/okky/velog 공략이 없음     |
| `robota --diagnose` 없음 | 설치 실패 사용자가 자가 진단 불가 → 이탈                 |
| 첫 사용자 초청 루프 없음 | Beta 참가자 모집 → 피드백 → Showcase 제출 루프가 없음    |
| Product Hunt 준비 미비   | B2 (CJK 크래시)가 해결 안 된 채로 런칭하면 역효과        |

---

## 4. 전략적 방향성 판단

### 현재 포지셔닝 (마케팅)

> "Claude Code 대안 CLI" — Anthropic 독점이 싫은 개발자를 위한 멀티 프로바이더 터미널 어시스턴트

### 실제 아키텍처 강점 (코드)

> "AI 코딩 도구를 만드는 엔진" — `@robota-sdk/agent-framework`를 import해서 세션 관리/권한/멀티 프로바이더를 5분 만에 내 앱에 탑재

**두 관점 모두 B경로(SDK 플랫폼)를 지지한다.**

| 비교            | A경로: CLI 경쟁                               | B경로: SDK 플랫폼                           |
| --------------- | --------------------------------------------- | ------------------------------------------- |
| 경쟁자          | Claude Code (Anthropic 백업, 수년간 다듬어짐) | **없음**                                    |
| 시장 크기       | 개인 개발자 + 비Anthropic 선호 팀             | AI 도구 빌더 전체                           |
| 포지셔닝 난이도 | 어려움 ("Claude Code보다 좋다"는 증명 필요)   | 쉬움 ("유일한 임베딩 가능 에이전트 런타임") |
| 현재 코드 지원  | 보통 (CLI는 가장 얇은 레이어)                 | 강함 (agent-framework가 핵심)               |

**권장**: CLI를 "SDK 체험 도구"로 재포지셔닝. CLI를 쓰다가 "이 엔진을 내 앱에도 넣고 싶다"는 전환 경로를 명확하게 만든다.

---

## 5. 검증 프레임워크

### 핵심 질문

> "개발자가 설치하고, 첫 가치를 얻고, 다음 날도 다시 쓰며, 결국 SDK를 자기 프로젝트에 임베딩하는가?"

### 단계별 성공 기준

#### Phase 1: 진입 장벽 제거 (지금 ~ beta.70)

- [ ] Node 20 환경에서 `npx @robota-sdk/agent-cli` 성공률 95%+
- [ ] macOS Terminal.app에서 CJK 입력 크래시 0건
- [ ] 첫 실행 → 첫 AI 응답 ≤ 2분

#### Phase 2: Core 경험 검증 (beta.70 ~ v1.0.0-rc)

- [ ] 외부 개발자 10명 독립 설치 → 7명 성공
- [ ] 1주일 후 5명이 여전히 사용 중
- [ ] 치명적 버그(데이터 손실, 무한 크래시) 0건

#### Phase 3: 성장 지표 (v1.0.0 ~)

- [ ] npm 주간 다운로드 500+
- [ ] GitHub Stars 200+
- [ ] SDK 임베딩 실제 사용 사례 3건 이상

### 검증 방법론

1. **내부 도그푸딩**: 팀 전체가 이 리포지토리 개발에 robota CLI를 실제 사용
2. **외부 Beta 초청**: GitHub Discussions 통해 TypeScript 개발자 10-20명 초청
3. **설치 영상 수집**: Loom으로 첫 설치 과정 녹화 요청 → 마찰 지점 시각화
4. **비구조화 인터뷰**: 매주 "사용하다 막힌 점" 30분 대화

---

## 6. 통합 우선순위 액션 플랜

### P0: 채택 블로커 (지금 당장)

1. **Node.js 버전 체크 + 친절한 안내** — Node 22 요구를 명확히 하거나 낮춤. 적어도 오류 시 `nvm install 22` 안내
2. **macOS Terminal.app CJK 크래시** — CLI-016 done 표시됐지만 실제 근본 해결 여부 재확인. 안 됐으면 첫 실행 시 iTerm2 강력 권고
3. **`--system-prompt` / `--append-system-prompt` 구현 완료** — 문서에 있는데 안 되는 기능은 신뢰 손상

### P1: Core 경험 완성

4. **Bash 권한 세션-레벨 "이 세션에서 항상 허용"** — 권한 피로 해소 없이 실무 사용 불가
5. **첫 실행 가이드: "이런 걸 물어보세요"** — Aha Moment 경로 단축
6. **`robota --diagnose`** — 설치 실패 자가 진단
7. **비용 추적 정확화** — 공개 가격표 내장, provider별 비교 표시

### P2: 성장 인프라

8. **공식 GitHub Action `robota-sdk/action@v1`** — CI/CD 포지셔닝 실체화
9. **Git 통합 first-class** — `/commit`, `/status`, `/diff` 명령
10. **SDK Starter Kit 레포** — Next.js + Express 임베딩 10분 경험
11. **한국어 우선 마케팅** — GeekNews, okky, velog 포스팅
12. **외부 개발자 베타 초청 + Showcase 유치**

### P3: 생태계

13. **공식 플러그인 최소 1개 실제 배포** — 플러그인 시스템 실체화
14. **통합 테스트 커버리지 확장** — 헤드리스 e2e 시나리오
15. **opt-in 익명 텔레메트리** — 제품 개선 데이터 확보

---

## 7. 관련 백로그 목록

아래 백로그 항목들이 이 검증 보고서를 기반으로 생성됐다:

### P0 — 채택 블로커

- [CLI-027](../backlog/CLI-027-system-prompt-flag-implementation.md): `--system-prompt` 실제 구현
- [CLI-028](../backlog/CLI-028-nodejs-version-gate.md): Node.js 버전 체크 및 친절한 안내
- [CLI-029](../backlog/CLI-029-macos-cjk-crash-recheck.md): macOS Terminal.app CJK 크래시 재확인

### P1 — Core 경험

- [CLI-030](../backlog/CLI-030-bash-session-allow.md): Bash 세션-레벨 "이 세션에서 허용" 옵션
- [CLI-031](../backlog/CLI-031-tool-output-truncation-notice.md): 도구 출력 30k 자 truncation 알림
- [PM-023](../backlog/PM-023-first-run-onboarding-guide.md): 첫 실행 가이드 ("이런 걸 물어보세요")
- [PM-024](../backlog/PM-024-diagnose-command.md): `robota --diagnose` 자가 진단
- [PM-025](../backlog/PM-025-cost-accuracy.md): 비용 추적 정확화

### P2 — 성장

- [CLI-032](../backlog/CLI-032-git-first-class-commands.md): git first-class 통합
- [CLI-033](../backlog/CLI-033-headless-e2e-tests.md): 헤드리스 통합 테스트
- [PM-026](../backlog/PM-026-github-action-official.md): 공식 GitHub Action
- [PM-027](../backlog/PM-027-korean-marketing-content.md): 한국어 우선 마케팅
- [PM-028](../backlog/PM-028-beta-invite-program.md): 외부 베타 초청 프로그램

### P3 — 생태계

- [CLI-034](../backlog/CLI-034-plugin-publish-one-official.md): 공식 플러그인 최소 1개 배포
- [PM-029](../backlog/PM-029-sdk-starter-kit.md): SDK Starter Kit 레포
- [PM-030](../backlog/PM-030-opt-in-telemetry.md): opt-in 익명 텔레메트리

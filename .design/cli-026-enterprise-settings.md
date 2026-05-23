# CLI-026: 엔터프라이즈 설정 레이어 설계

## 배경

현재 설정 우선순위 (낮은 것 → 높은 것):

```
~/.robota/settings.json       (user)
~/.claude/settings.json       (user, Claude Code compat)
.robota/settings.json         (project)
.robota/settings.local.json   (project-local)
.claude/settings.json         (project, Claude Code compat)
.claude/settings.local.json   (project-local, 최우선)
```

조직 정책을 강제할 수 있는 `org` 레이어가 없다.

## 설계 방향

### 설정 우선순위 (확장 후)

```
org-policy.json  (org/system — 최상위, 모든 설정 오버라이드 가능)
  ↓ 위반 시 에러, 허용된 범위 내에서만 아래 레이어 적용
~/.robota/settings.json       (user)
.robota/settings.local.json   (project-local)
...
```

`org-policy`는 **오버라이드(override)가 아니라 제약(constraint)** 모델로 동작한다.
개인/프로젝트 설정이 정책 범위를 초과하면 시작 시 에러를 발생시킨다.

### 정책 파일 로드 경로

우선순위 순:

1. `ROBOTA_ORG_POLICY_URL` 환경 변수 → HTTP(S) fetch (원격 배포 지원)
2. `ROBOTA_ORG_POLICY_FILE` 환경 변수 → 파일 경로
3. `~/.robota/org-policy.json` → 사용자 로컬 (MDM 배포용)

파일이 없으면 정책 없음 (기존 동작 유지).

### `org-policy.json` 스키마

```typescript
interface IOrgPolicy {
  version: 1;
  /** 사용 가능한 tool 목록. 미지정 시 제한 없음 */
  allowedTools?: string[];
  /** 차단된 slash-command 목록 */
  blockedCommands?: string[];
  /** 허용된 provider type 목록 */
  allowedProviders?: string[];
  /** API 키를 반드시 env var에서 로드 강제 */
  requireApiKeyFromEnv?: boolean;
  /** 감사 로그 수집 엔드포인트 */
  auditLogEndpoint?: string;
  /** 정책 위반 시 표시할 관리자 연락처 */
  adminContact?: string;
}
```

### 정책 적용 시점

1. **시작 시 (startup):** `config-loader.ts`에서 org-policy를 로드하고 `IResolvedConfig`와 교차 검증
2. **커맨드 실행 시 (runtime):** `blockedCommands`는 `CommandRegistry`에서 커맨드 등록 전 필터링
3. **tool 실행 시:** `allowedTools`는 `InteractiveSession`의 tool 호출 시 검증

### 에러 메시지 예시

```
[Org Policy] Provider "openai" is not in the allowed providers list.
Allowed providers: anthropic
Contact your administrator: security@example.com
```

## 영향 범위

| 파일                                                              | 변경 내용                                      |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `packages/agent-framework/src/config/org-policy-loader.ts`        | 신규 — 정책 파일 로드 및 파싱                  |
| `packages/agent-framework/src/config/config-loader.ts`            | org-policy 로드 후 `IResolvedConfig` 교차 검증 |
| `packages/agent-framework/src/config/config-types.ts`             | `IOrgPolicy` 타입 추가                         |
| `packages/agent-command/src/`                                     | `blockedCommands` 필터링 적용                  |
| `packages/agent-framework/src/interactive/interactive-session.ts` | `allowedTools` 정책 검증                       |

## 리스크

- **원격 fetch 실패 시 동작:** 기본값은 "fail open" (정책 없음으로 처리) vs "fail closed" (시작 불가) — 팀 논의 필요
- **정책 파일 위변조:** HTTP fetch 시 HTTPS 강제 + 인증 토큰 지원 필요 여부 검토
- **성능:** 시작 시 원격 fetch가 startup latency를 증가시킬 수 있음 — 캐싱 전략 필요

## 구현 순서

1. `IOrgPolicy` 타입 + `org-policy-loader.ts` 구현 (파일 기반부터)
2. `config-loader.ts`에 교차 검증 통합
3. `blockedCommands` 커맨드 필터링 적용
4. `allowedTools` 툴 실행 시 검증
5. 원격 fetch 지원 (HTTPS only, timeout)
6. 단위 테스트 및 통합 테스트

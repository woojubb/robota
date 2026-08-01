---
title: 'CLI-026: 엔터프라이즈 설정 레이어 (org-policy, RBAC)'
status: done
created: 2026-05-23
priority: low
urgency: later
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

## Background

현재 `.robota/settings.json`은 개인 또는 프로젝트 레벨 설정만 지원한다. 조직 레벨 정책(허용 툴, 금지 커맨드, 프로바이더 제한, 감사 로그 수집 등)을 중앙에서 강제할 수 있는 레이어가 없다.

엔터프라이즈 고객이 팀 전체에 동일한 보안 정책을 적용하려면 각 개발자 로컬 설정을 수동으로 관리해야 한다. Claude Code의 엔터프라이즈 포지셔닝을 공략하기 위한 기반 기능이다.

## 작업 항목

설계 문서(`.design/enterprise-settings-design.md`)를 먼저 작성하고 사용자 승인 후 구현.

설계 내용:

- 설정 우선순위 레이어 정의: `system` > `org` > `project` > `user`
- `~/.robota/org-policy.json` 또는 환경 변수(`ROBOTA_ORG_POLICY_URL`) 기반 org 정책 로드
- 정책 항목 설계:
  - `allowedTools`: 사용 가능한 툴 목록
  - `blockedCommands`: 금지된 슬래시 커맨드
  - `allowedProviders`: 사용 가능한 프로바이더 목록
  - `auditLogEndpoint`: 원격 감사 로그 수집 엔드포인트
  - `requireApiKeyFromEnv`: API 키를 환경 변수에서만 로드 강제
- 정책 위반 시 명확한 에러 메시지 및 관리자 연락처 표시

## Test Plan

- org 정책 파일이 존재하는 경우 정책이 올바르게 적용되는지 확인
- 정책 위반 커맨드/툴 사용 시 명시적 거부 메시지 확인
- 정책 파일 없는 경우 기존 동작 유지 확인

## User Execution Test Scenarios

### Scenario 1: 금지된 툴 차단

```json
// ~/.robota/org-policy.json
{ "blockedCommands": ["/reset"], "allowedProviders": ["anthropic"] }
```

```bash
robota
> /reset
```

Expected: 조직 정책에 의해 차단된다는 메시지 출력, 실행 거부

## Evidence (done: 2026-05-23)

- `IOrgPolicy` interface in `packages/agent-framework/src/command-api/org-policy/`
- `loadOrgPolicy()` reads `~/.robota/org-policy.json` (null if missing/malformed)
- `blockedCommands` enforced in `InteractiveSession.executeCommand()` before dispatch
- `allowedProviders` enforced at `/provider switch` (in `buildProviderSwitch`) and at startup (`cli.ts`)
- `requireApiKeyFromEnv` enforced in `completeProviderEdit` — rejects plaintext keys
- `adminContact` appended to every violation message
- 4 org-policy unit tests in `packages/agent-command/src/provider/__tests__/org-policy.test.ts` — all passing
- Design doc: `.design/cli-026-enterprise-settings-design.md`
- `allowedTools` deferred — not included in MVP (user approved exclusion)

# CLI-026: 엔터프라이즈 설정 레이어 설계안

작성일: 2026-05-23

---

## 1. 문제 정의

현재 Robota의 설정 체계는 `user` > `project` 2계층이다. 조직(팀, 기업) 단위의 정책을 중앙에서 강제할 방법이 없다. 엔터프라이즈 팀이 사용할 경우:

- 보안: 특정 프로바이더만 허용, API 키를 평문 저장 금지
- 컴플라이언스: 특정 커맨드(예: `/reset`, `/plugin`) 차단
- 운영: 정책 위반 시 관리자 연락처 자동 안내

이를 위해 `org` 레이어를 추가한다.

---

## 2. 설정 우선순위 레이어 (제안)

```
system (읽기전용, 미래 확장)
  └── org        ← 이번 작업에서 추가
        └── project
              └── user   ← 현재 최상위 (project가 user를 오버라이드)
```

실제 적용 순서: `org` 정책이 `project` / `user` 설정을 **오버라이드** (강제 제한). 단 org 정책은 "허용 범위를 좁히는 것"만 가능하고, user 설정을 "강제로 값을 지정"하지는 않는다.

---

## 3. Org 정책 파일 위치 (제안)

두 가지 방식을 지원:

### A. 로컬 파일 (기본)

```
~/.robota/org-policy.json
```

팀 환경에서는 dotfile 관리 도구(chezmoi, Puppet, Ansible) 또는 회사 MDM으로 이 파일을 배포.

### B. 원격 URL (선택, 환경변수)

```bash
ROBOTA_ORG_POLICY_URL=https://policy.example.com/robota-policy.json
```

URL이 설정되면 시작 시 fetch, 응답을 로컬 캐시(`~/.robota/.org-policy-cache.json`)에 저장. 네트워크 오류 시 캐시 사용. 캐시 TTL: 1시간.

**추천: A 방식을 MVP, B 방식은 선택 구현.** 원격 URL은 보안/네트워크 복잡도가 높아 초기 MVP에서는 파일 기반만 구현하고 URL은 설계에만 열어두는 것이 현실적.

---

## 4. 정책 스키마 (제안)

```typescript
interface IOrgPolicy {
  // 허용 프로바이더 목록 (미설정 시 모두 허용)
  allowedProviders?: string[];

  // 차단할 슬래시 커맨드 목록 (예: ["reset", "plugin"])
  blockedCommands?: string[];

  // true면 API 키를 파일에 평문 저장 거부, 환경변수만 허용
  requireApiKeyFromEnv?: boolean;

  // 정책 위반 시 표시할 관리자 연락처
  adminContact?: string;
}
```

**이번 MVP에서 제외하는 항목:**

- `auditLogEndpoint`: 원격 전송은 개인정보/보안 설계가 별도로 필요. 추후 CLI-027로 분리.
- `allowedTools` (MCP 툴 화이트리스트): 기존 `permissions.allow/deny`와 중복. 통합 설계 필요.

---

## 5. 적용 방식 (아키텍처)

### 5-1. 정책 적용 시점

| 정책 필드              | 적용 시점                        | 구현 위치                                                              |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `allowedProviders`     | 시작 시 + `/provider switch` 시  | `provider-startup.ts` + `InteractiveSession.executeCommand()` override |
| `blockedCommands`      | 커맨드 실행 시                   | `InteractiveSession.executeCommand()` override                         |
| `requireApiKeyFromEnv` | `/provider add` / `edit` 완료 시 | `buildProviderSwitch`, `completeProviderEdit`                          |
| `adminContact`         | 정책 위반 메시지에 포함          | 각 에러 메시지 포맷터                                                  |

### 5-2. 새 모듈 위치

```
packages/agent-framework/src/command-api/org-policy/
  ├── org-policy-types.ts      # IOrgPolicy 인터페이스
  ├── org-policy-loader.ts     # 파일/캐시 로드
  └── index.ts
```

`InteractiveSession` options에 `orgPolicy?: IOrgPolicy` 주입.

### 5-3. 커맨드 차단 흐름

```
user: /reset
  → InteractiveSession.executeCommand('reset', '')
    → orgPolicy.blockedCommands.includes('reset') → true
    → return { message: 'Command /reset is blocked by your organization policy. Contact: admin@example.com', success: false }
```

TUI에는 세션 재시작 없이 인라인 에러 메시지로 표시.

---

## 6. 구현 범위 (MVP)

### In scope

- `IOrgPolicy` 타입 정의 (`packages/agent-framework/src/command-api/org-policy/`)
- `loadOrgPolicy(cwd: string): IOrgPolicy | null` — 파일 기반 로드
- `InteractiveSession` constructor에 `orgPolicy` 옵션 추가
- `executeCommand` override에서 `blockedCommands` 체크
- `ensureConfig` / provider init에서 `allowedProviders` 체크
- `requireApiKeyFromEnv` — provider 설정 write 시 검증
- `formatOrgPolicyViolationMessage(policy, violation)` 유틸리티

### Out of scope (이번 PR)

- `ROBOTA_ORG_POLICY_URL` 원격 fetch
- `auditLogEndpoint`
- `allowedTools` (기존 permissions와 통합 별도)
- CLI 인수로 org-policy 파일 경로 지정 (`--org-policy-file`)

---

## 7. 예시 정책 파일

```json
// ~/.robota/org-policy.json
{
  "allowedProviders": ["anthropic", "qwen"],
  "blockedCommands": ["reset", "plugin"],
  "requireApiKeyFromEnv": true,
  "adminContact": "dev-tools@example.com"
}
```

실행 시:

```
> /reset
⛔ Command /reset is blocked by your organization policy.
   Contact: dev-tools@example.com
```

```
> /provider switch openai
⛔ Provider "openai" is not in the allowed providers list.
   Allowed: anthropic, qwen
   Contact: dev-tools@example.com
```

---

## 8. 설계 결정 근거

**왜 별도 레이어를 추가하는가?**
기존 settings merge를 단순히 "더 강한 것이 이긴다"로 확장하면 user > project 순서와 충돌. Org 정책은 "제한만 가능한 별도 체계"여야 하므로 분리.

**왜 로컬 파일만 MVP?**
원격 URL은 네트워크 실패 처리, 인증, 캐시 일관성 등 부가 복잡도가 크다. 로컬 파일은 MDM/dotfile 도구로 동등한 배포 효과를 낼 수 있다.

**왜 `auditLogEndpoint`를 제외했나?**
원격 전송은 어떤 데이터를 보내는지 사용자에게 명시적으로 알려야 하고, GDPR 등 규정 검토가 필요. 별도 이슈(CLI-027)로 분리 추천.

---

## 9. 검토 요청 사항

1. **MVP 범위 적절한가?** `blockedCommands`, `allowedProviders`, `requireApiKeyFromEnv` 3가지로 좁혔는데, 빠진 것이 있는가?
2. **정책 파일 위치** — `~/.robota/org-policy.json` 외에 `.robota/org-policy.json` (프로젝트 스코프) 도 지원해야 하는가?
3. **`allowedTools`** — 기존 `permissions.allow/deny`와 통합 설계가 필요한지, 이번 PR에서 별개로 추가할지?

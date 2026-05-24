# @robota-sdk/agent-cli 시니어 개발자 평가 보고서

> 작성 기준: 2026-05-24 | 버전: 3.0.0-beta.67 | 평가자 페르소나: TypeScript/Node.js 10년 경력 시니어 풀스택 개발자

---

## 1. 평가 개요

이 보고서는 `@robota-sdk/agent-cli`를 실제 개발 워크플로우에 투입 가능한지 판단하기 위한 시니어 개발자 관점의 기술 평가다. 칭찬보다는 "당장 쓸 수 있는가", "어디서 막히는가", "경쟁 도구 대비 왜 선택해야 하는가"에 집중한다.

### 평가 판단 기준

| 기준                     | 설명                                                          |
| ------------------------ | ------------------------------------------------------------- |
| **즉시 투입 가능성**     | 설치 후 5분 안에 의미 있는 작업을 수행할 수 있는가            |
| **신뢰성**               | 크래시 없이 일관된 동작을 하는가                              |
| **기술적 완성도**        | 아키텍처가 장기적으로 확장 가능한가                           |
| **차별화 가치**          | Claude Code, Cursor, Aider가 없을 때 이 툴을 쓸 이유가 있는가 |
| **실전 워크플로우 통합** | git, CI, 팀 협업 워크플로우에 녹아들 수 있는가                |

### 총평 (선요약)

**현재 상태: 아키텍처는 훌륭하나, 사용자 경험은 베타 수준.**

- 아키텍처 설계: A급 (레이어 분리, DI, 이벤트 기반, 타입 안전성)
- 사용자 경험: B-급 (Node.js 22 강제, macOS 크래시 이슈, 문서 분산)
- 실전 투입 가능성: 현재 기준 **60점** — 개인 프로젝트 탐색용으로는 충분하나, 팀 온보딩과 CI 통합에는 마찰이 크다.

---

## 2. 검증 방법론

### 2.1 검증 단계

```
1단계: 설치 검증 (5분)
   npx @robota-sdk/agent-cli
   → 첫 실행 시 provider 선택 플로우가 자연스러운가
   → API key 오류 메시지가 actionable한가

2단계: 초기 설정 (10분)
   robota --configure
   → 여러 provider profile 설정 후 전환이 자연스러운가
   → ~/.robota/settings.json 구조가 합리적인가

3단계: 실제 프로젝트 투입 (1시간)
   → AGENTS.md / CLAUDE.md 자동 로딩 확인
   → 파일 읽기/쓰기/편집 도구 동작 확인
   → 권한 모드(plan/default/acceptEdits) 체감 차이 확인
   → 대화 세션 저장/복원 (.robota/sessions/)

4단계: 스트레스 테스트 (30분)
   → 대규모 파일 처리 (context 90%+ 상황)
   → 긴 세션 후 메모리/성능
   → 멀티 도구 호출 체인 (Bash + Read + Edit 연속)

5단계: 팀 통합 가능성 평가
   → headless 모드 (-p) CI 통합
   → .robota/settings.json git 공유 시나리오
   → 슬래시 커맨드 skill 팀 공유
```

### 2.2 구체적 테스트 시나리오

**시나리오 A: 코드 리팩토링**

```bash
robota "이 파일의 any 타입을 모두 제거해줘"
# 예상: Read → Grep → Edit 도구 체인
# 검증 포인트: diff 표시, 권한 프롬프트 동작
```

**시나리오 B: 버그 추적**

```bash
robota -c "방금 수정한 파일에서 실패하는 테스트를 찾아서 고쳐줘"
# 예상: Bash(pnpm test) → Read → Edit
# 검증 포인트: Bash 권한, 세션 연속성
```

**시나리오 C: CI 파이프라인 통합**

```bash
git diff HEAD~1 | robota -p "이 변경사항의 보안 취약점을 분석해줘" --output-format json
# 검증 포인트: stdout 결정론적 출력, 비대화형 모드 안정성
```

**시나리오 D: 비용 추적**

```bash
robota
/cost
# 예상: 세션 토큰 사용량 표시
# 검증 포인트: provider별 정확한 비용 계산
```

---

## 3. 현재 상태 분석

### 3.1 강점

**아키텍처적 강점 (코드 분석 기반)**

1. **레이어 분리가 명확하다.** `cli.ts`를 보면 5개 레이어(preflight → config → provider → runtime → mode)로 깔끔하게 분리되어 있다. CLI는 진짜 얇은 껍데기이고 비즈니스 로직은 `agent-framework`에 있다. 이런 구조는 테스트 가능성과 장기 유지보수성에서 다른 CLI 도구 대비 우위다.

2. **프로바이더 중립성.** `IProviderDefinition` 패턴으로 CLI 코드가 Anthropic/OpenAI 같은 구체적 프로바이더를 모른다. 새 프로바이더 추가가 CLI 수정 없이 가능하다. 실무에서 중요한 특성이다.

3. **권한 시스템이 실용적이다.** `plan/default/acceptEdits/bypassPermissions` 4단계 + 패턴 기반 allow/deny 조합은 Claude Code에서 검증된 모델을 그대로 가져왔다. 팀에서 `"deny": ["Bash(rm -rf *)"]` 같은 설정을 공유할 수 있다.

4. **세션 관리가 완성도 있다.** `-c` (continue), `-r` (resume), fork, 이름 지정까지 지원한다. JSONL 로그 + JSON 세션 파일 분리 설계도 합리적이다.

5. **헤드리스 모드가 CI 통합을 염두에 뒀다.** `-p` 모드에서 update check를 완전히 끄고 `--output-format stream-json`으로 결정론적 출력을 보장하는 설계 결정은 실무 지향적이다.

6. **CJK 입력 지원.** 한국어 사용자를 위한 CJK 전용 텍스트 입력 컴포넌트를 만든 것은 국내 개발자 대상이라면 중요한 차별화다.

### 3.2 약점

**사용자 경험 약점**

1. **Node.js 22 강제 요구사항이 진입 장벽이다.** 많은 기업 환경의 CI/CD 서버는 Node.js 18 LTS나 20 LTS를 사용한다. Ink 7.x가 Node 22를 요구한다고 README에 명시했지만, 실제로 Node 22가 강제 필요한지 체계적 검증 기록이 없다 (CLI-017이 `done` 처리되어 있으나 해결책이 문서화 단계인지 실제 낮춤인지 불명확하다).

2. **macOS Terminal.app 크래시.** CJK 입력 시 Terminal.app이 SIGSEGV로 크래시한다. iTerm2 권고가 README에 있지만, 이 제약은 여전히 심각하다. 한국 개발자를 타깃으로 한다면 기본 터미널에서 안정 동작은 필수다 (CLI-016은 `done`이지만 blank line 패치가 근본 해결인지 불명확하다).

3. **`--system-prompt`와 `--append-system-prompt` 플래그가 아직 미구현이다.** SPEC에 "parsed but not yet connected"로 명시되어 있다. 이 플래그는 CI 자동화에서 매우 유용한데, 문서에 있으나 동작하지 않는 기능은 사용자 신뢰를 깎아먹는다.

4. **첫 실행 경험이 provider-dependent하다.** API key 없이 LM Studio로 시작하는 경로가 문서화되어 있으나, 실제 첫 실행 플로우가 얼마나 자연스러운지 코드 수준에서 검증이 부족하다.

**기술적 약점**

1. **통합 테스트가 부족하다.** `__tests__/`에 4개 파일만 있다: `cli-command-composition.test.ts`, `cli-update-check.test.ts`, `print-mode-integration.test.ts`, `provider-factory-integration.test.ts`. TUI 동작, 권한 플로우, 세션 복원 같은 핵심 시나리오에 대한 통합 테스트가 없다 (CLI-023이 done이지만 충분한지 미지수).

2. **플러그인 마켓플레이스가 실제로 동작하는지 불명확하다.** SPEC에 `/plugin install <name>@<marketplace>` 명령이 상세히 문서화되어 있으나, 실제 공개 마켓플레이스가 있는지, 플러그인이 몇 개나 존재하는지 알 수 없다.

3. **메모리 관리에 하드코딩된 상수가 있다.** `MAX_RENDERED_MESSAGES = 100`, `MAX_COMPLETED_TOOLS = 50` 등 사용자 설정 불가. 긴 작업 세션에서 UX 저하가 발생할 수 있다.

4. **WebSearch/WebFetch 도구의 실제 구현 품질.** 8개 내장 도구 중 두 개가 외부 인터넷 의존인데, rate limit, 타임아웃, 콘텐츠 정제 품질에 대한 문서가 없다.

### 3.3 갭 (문서 vs 현실)

| 문서 주장              | 실제 상태                                                                                     | 갭 수준          |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| `--system-prompt` 지원 | 미구현 (플래그만 존재)                                                                        | 높음             |
| 플러그인 마켓플레이스  | 구조는 있으나 공개 플러그인 생태계 없음                                                       | 중간             |
| worktree isolation     | git worktree 자체가 절대 금지 (MEMORY.md)                                                     | 낮음 (내부 정책) |
| 비용 표시              | "Label monetary cost as unknown unless SDK provides exact pricing" — 실제로 unknown 표시 가능 | 중간             |

---

## 4. 실전 개발자 시나리오

### 시나리오 1: 레거시 코드 any 타입 제거 (리팩토링)

**상황**: TypeScript 코드베이스에서 `any` 타입을 모두 strict 타입으로 교체해야 한다.

```bash
robota --permission-mode acceptEdits "src/legacy/ 디렉토리의 any 타입을 모두 찾아서 적절한 타입으로 교체해줘. 변경 후 typecheck를 돌려서 확인해줘."
```

**지금 되는 것**:

- `Grep(any, src/legacy/)` → `Read` → `Edit` → `Bash(pnpm typecheck)` 체인 동작
- `acceptEdits` 모드로 파일 수정을 자동 승인하면서도 Bash는 수동 승인
- Edit diff가 인라인으로 표시되어 변경 내용 추적 가능
- `@src/types.ts` 같은 파일 참조로 컨텍스트 추가 가능

**막히는 것**:

- 수백 개 파일에 걸친 대규모 리팩토링 시 context 한계에 도달
- `/compact` 후 이전 타입 결정 컨텍스트가 유실될 수 있음
- 여러 파일에 걸친 변경의 원자성 보장 없음 (파일 A 수정 후 typecheck 실패 시 롤백 어려움)
- `/rewind` 기능이 있다고 SPEC에 있으나 실제 동작 검증 필요

**판정**: 파일 10개 미만의 국소적 리팩토링은 가능. 코드베이스 전체 리팩토링은 무리.

---

### 시나리오 2: 실패하는 테스트 버그 추적

**상황**: CI에서 테스트가 실패했고 원인을 찾아야 한다.

```bash
robota -c "pnpm test를 실행하고 실패하는 테스트를 분석해서 버그를 찾아줘"
```

**지금 되는 것**:

- `Bash(pnpm test)` 실행 후 출력 분석
- 실패 스택 트레이스를 기반으로 관련 파일 Read
- 원인 분석 후 Edit 제안

**막히는 것**:

- `default` 권한 모드에서 Bash 실행마다 "approve" 클릭이 필요 — 반복 작업에서 매우 번거롭다
- `bypassPermissions` 모드로 전환하면 `rm -rf` 같은 위험한 명령도 실행 가능 (패턴 deny가 있어도 사용자 실수 여지)
- 테스트 출력이 길 경우 30,000자 cap에 걸려 중간 잘림
- Bash 실행 후 exit code를 모델이 올바르게 해석하는지 보장 불명확

**판정**: 가능하지만 권한 프롬프트 피로도가 높다. `Bash(pnpm *)` 패턴을 allow에 추가하면 개선된다.

---

### 시나리오 3: 코드 리뷰 보조

**상황**: PR diff를 받아서 코드 품질 리뷰를 받고 싶다.

```bash
git diff main...feature/new-auth | robota -p "이 PR에서 보안 취약점, 타입 안전성 문제, 성능 이슈를 찾아줘" --output-format json
```

**지금 되는 것**:

- stdin pipe + `-p` 모드 조합이 설계되어 있음
- `--output-format json`으로 구조화된 출력
- 헤드리스 모드에서 update check 없이 결정론적 실행

**막히는 것**:

- 대형 PR (300줄+)의 경우 diff 자체가 context를 많이 차지
- 모델이 코드 컨텍스트 없이 diff만 보는 한계 (프로젝트 AGENTS.md는 로딩되지만 실제 파일은 Read 도구가 없는 print 모드에서 다름)
- JSON 출력 스키마가 고정되어 있어 CI 파이프라인 통합 시 커스터마이징 어려움
- `--system-prompt` 미구현으로 리뷰 프롬프트 템플릿 주입 불가

**판정**: 아이디어는 좋으나 `--system-prompt` 미구현이 치명적. 커스텀 리뷰 가이드라인을 주입할 수 없다.

---

### 시나리오 4: 새 기능 구현 (TDD 방식)

**상황**: 새 API 엔드포인트를 TDD로 구현해야 한다.

```bash
robota "user profile API를 TDD로 구현해줘. 먼저 failing test를 작성하고, 그다음 구현, 마지막으로 refactor"
```

**지금 되는 것**:

- 멀티 도구 체인 (Write → Bash → Edit 반복)
- AGENTS.md에서 프로젝트 컨벤션 자동 로딩
- 세션 유지로 이전 결정 컨텍스트 보존

**막히는 것**:

- 긴 TDD 사이클에서 context 창이 빠르게 차오름 (auto-compact가 83.5%에서 트리거되지만 이후 컨텍스트 손실 위험)
- 여러 파일을 동시에 생성해야 할 때 원자적 Write 없음
- 모델이 기존 코드 스타일을 참고하려면 Read 호출이 많아지는데 매번 permission 확인
- `max-turns` 제한에 걸리면 중간에 멈춤

**판정**: 소규모 단일 기능 구현에는 유용. 여러 파일에 걸친 복잡한 기능은 중간에 human intervention 필요.

---

### 시나리오 5: 프로바이더 전환으로 비용 최적화

**상황**: 비싼 Anthropic Opus 대신 DeepSeek로 단순 작업을 처리하고 싶다.

```bash
robota
/provider switch deepseek-chat
"이 파일들의 주석을 영어로 번역해줘"
/provider switch claude-opus-4
"이제 복잡한 아키텍처 분석을 해줘"
```

**지금 되는 것**:

- `/provider switch` 핫 스왑이 구현되어 있음 (세션 재시작 없이 대화 히스토리 보존)
- 설정 파일에 여러 profile 저장 가능
- 세션 내에서 provider 전환

**막히는 것**:

- 각 provider별 비용이 "unknown"으로 표시될 수 있음 (exact pricing data 없는 경우)
- provider 전환 후 모델 능력 차이로 이전 컨텍스트 이해도 저하 가능
- profile 이름이 model ID 기반이라 `claude-opus-4`와 `claude-opus-4-high-context` 같은 용도별 구분 불편

**판정**: 핫 스왑 자체는 차별화된 강점. 비용 추적이 정확하게 동작하면 더 유용할 것.

---

### 시나리오 6: 팀 컨텍스트 공유 (AGENTS.md 활용)

**상황**: 팀원이 AGENTS.md에 정의한 프로젝트 규칙을 AI가 자동으로 따르도록 하고 싶다.

```bash
# AGENTS.md에 코딩 컨벤션, 금지 패턴, 아키텍처 규칙 정의
robota "새 서비스 클래스를 만들어줘"
```

**지금 되는 것**:

- cwd부터 filesystem root까지 walk-up으로 AGENTS.md / CLAUDE.md 자동 발견
- package.json, tsconfig.json 메타데이터도 시스템 프롬프트에 포함
- `.robota/settings.json`을 git으로 공유해서 팀 권한 정책 통일

**막히는 것**:

- AGENTS.md가 길어질수록 context 소비 증가 (토큰 예산 관리 필요)
- 팀원마다 다른 provider를 쓸 때 동작 일관성 보장 어려움
- skill 파일(`.agents/skills/`)을 git으로 공유하면 팀 전체에서 커스텀 슬래시 커맨드 사용 가능 — 이 부분은 실질적인 강점

**판정**: AGENTS.md 자동 로딩과 skill 공유는 팀 워크플로우에서 가치 있는 기능.

---

## 5. 경쟁 도구 대비 포지셔닝

### 5.1 Claude Code와 비교

| 항목         | Claude Code     | @robota-sdk/agent-cli                           |
| ------------ | --------------- | ----------------------------------------------- |
| 모델         | Anthropic 전용  | Anthropic, OpenAI, DeepSeek, Gemini, Qwen, 로컬 |
| 라이센스     | 독점            | MIT 오픈소스                                    |
| 커스터마이징 | 제한적          | SDK 수준 확장 가능                              |
| 기업 통제    | 없음            | org-policy 레이어 있음                          |
| 완성도       | 프로덕션        | 베타                                            |
| 문서         | 방대하고 안정적 | 개발 중                                         |
| 비용         | Anthropic 종속  | 최저가 provider 선택 가능                       |

**Robota CLI를 선택할 이유**:

- Anthropic 외 provider를 써야 하는 기업 정책
- 특정 로컬 모델(LM Studio)을 사용하는 개인 프로젝트
- SDK를 직접 임베딩해서 커스텀 도구를 만들고 싶은 경우
- MIT 오픈소스라 포크/커스터마이징이 필요한 경우

**Robota CLI를 선택하지 말아야 할 이유**:

- 즉시 프로덕션 투입이 필요한 경우 (Claude Code가 더 안정적)
- 팀 전체가 이미 Claude Code를 쓰고 있고 전환 비용을 감수할 이유가 없는 경우

### 5.2 Cursor와 비교

Cursor는 IDE 플러그인이고 Robota CLI는 터미널 도구다. 직접 경쟁이 아니라 보완 관계다. `git diff | robota -p` 같은 파이프라인 통합은 Cursor가 제공하지 않는 가치다.

### 5.3 Aider와 비교

| 항목            | Aider                | @robota-sdk/agent-cli   |
| --------------- | -------------------- | ----------------------- |
| 성숙도          | 프로덕션             | 베타                    |
| git 통합        | 네이티브 auto-commit | 없음 (Bash 도구로 수동) |
| 멀티 파일 편집  | 강함                 | 제한적                  |
| 터미널 UI       | 텍스트 기반          | Ink TUI (더 풍부)       |
| 플러그인 시스템 | 없음                 | 있음                    |
| 세션 관리       | 기본적               | 상세함                  |
| 한국어 지원     | 없음                 | 있음 (CJK 입력)         |

**Robota CLI의 실질적 차별화 포인트**:

1. **멀티 프로바이더 핫 스왑** — 세션 중 모델 전환
2. **플러그인/skill 생태계** — 팀 커스텀 슬래시 커맨드
3. **SDK 임베딩** — `InteractiveSession`을 직접 활용하는 커스텀 도구 빌드
4. **조직 정책(org-policy) 레이어** — 기업 환경 배포

---

## 6. 기술적 방향성 제안

### 6.1 즉시 해결해야 할 기술 부채

**`--system-prompt` 구현 완료**
SPEC과 README에 명시된 기능이 실제로 동작하지 않는다. 문서에 있는데 안 되는 기능은 신뢰를 깎아먹는다. 이 플래그는 CI 통합과 커스텀 리뷰 워크플로우에 필수다.

**통합 테스트 커버리지**
현재 CLI 통합 테스트는 4개 파일뿐이다. TUI 없이 동작하는 headless 통합 테스트를 추가해야 한다. 특히 세션 복원, provider 전환, 권한 플로우 같은 핵심 경로가 자동 검증되지 않으면 베타 딱지를 떼기 어렵다.

### 6.2 아키텍처 결정

**플러그인 생태계 활성화 또는 솔직한 로드맵**
SPEC에 플러그인 마켓플레이스가 상세히 설계되어 있으나, 실제 공개 플러그인이 없다면 이 기능은 "있어 보이는" 기능이다. plugin-github, plugin-jira, plugin-linear, plugin-notion, plugin-slack 패키지가 monorepo에 있는데 이것들의 배포 상태와 완성도를 명확히 해야 한다.

**git 통합 강화**
Aider의 핵심 강점은 git auto-commit이다. Robota CLI에서 `/commit`, `/pr`, `/branch` 같은 git 워크플로우 커맨드가 없다. Bash 도구로 직접 git 명령을 실행할 수 있지만, git 통합이 first-class가 아니라는 점이 코딩 어시스턴트로서의 약점이다.

**비용 추적 정확도**
`/cost` 명령과 usage summary에서 비용이 "unknown"으로 표시되는 상황은 실무에서 비용 최적화가 필요한 팀에게 가치를 제공하지 못한다. Anthropic, OpenAI, DeepSeek의 공개 가격표를 하드코딩하거나 설정 가능하게 하는 것이 현실적이다.

### 6.3 Node.js 22 의존성 관리

Ink 7이 Node 22를 요구하는 것이 근본 제약이다. 두 가지 방향이 가능하다:

1. **accept**: Node 22 강제를 명확히 커뮤니케이션하고 nvm/Volta 설치 자동화 스크립트 제공
2. **decouple**: headless 모드(`-p`)는 Ink 없이 Node 18+에서 동작하도록 분리

Option 2가 CI 통합 친화적이지만 구현 비용이 크다. 단기적으로는 Option 1이 현실적이다.

---

## 7. 우선순위 백로그 제안

아래는 시니어 개발자 관점에서 지금 당장 만들어야 할 기능과 픽스 목록이다. 우선순위는 P1(즉시)/P2(2주 내)/P3(1개월 내)로 구분했다.

---

### P1: 즉시 처리

**BKL-01: `--system-prompt`와 `--append-system-prompt` 구현 완료**

- 이유: SPEC에 명시, README에 문서화, 실제 미구현. CI 통합과 커스텀 워크플로우에 필수. 문서와 현실의 불일치는 신뢰도 훼손.
- 우선순위: P1 (신뢰도 문제)

**BKL-02: Bash 권한 연속 승인 피로 해소 — 세션 내 도구별 "이 세션에서 항상 허용" 옵션**

- 이유: 현재 `default` 모드에서 Bash 실행마다 승인이 필요한데 반복 작업에서 번거롭다. Claude Code처럼 "이 세션에서 허용" 옵션이 없으면 실무에서 모두 `bypassPermissions`로 전환하게 된다 (더 위험).
- 우선순위: P1 (UX 핵심 마찰)

**BKL-03: Tool output 30,000자 cap 시 사용자 알림 개선**

- 이유: 현재 툴 출력이 중간 잘림될 때 사용자에게 명확한 알림이 없다. 잘린 출력을 기반으로 모델이 틀린 결론을 내릴 수 있다.
- 우선순위: P1 (정확성 문제)

---

### P2: 2주 내

**BKL-04: 비용 추적 정확도 개선 — provider별 공개 요금 테이블 내장**

- 이유: `/cost` 명령이 "unknown"을 표시하면 비용 최적화 목적으로 쓸 수 없다. Anthropic, OpenAI, DeepSeek 공개 가격은 자주 바뀌지 않으므로 하드코딩 + 사용자 오버라이드 방식으로 해결 가능.
- 우선순위: P2

**BKL-05: headless 통합 테스트 — print mode + provider + session restore 핵심 경로**

- 이유: 4개 파일의 통합 테스트로는 베타 졸업을 할 수 없다. TUI 없이 동작하는 시나리오 기반 테스트를 추가해야 리그레션 방지가 가능하다.
- 우선순위: P2

**BKL-06: git 통합 built-in 커맨드 — `/commit`, `/status`, `/diff`**

- 이유: 코딩 어시스턴트의 핵심 워크플로우가 git이다. Bash 도구로 `git commit`을 직접 실행하게 두면 커밋 메시지 품질과 staged 파일 선택을 AI가 관리하기 어렵다. first-class git 통합이 Aider 대비 포지셔닝에 필수.
- 우선순위: P2

**BKL-07: 공식 플러그인 최소 1개 이상 실제 배포 및 설치 검증**

- 이유: 플러그인 시스템은 설계가 훌륭하지만 실제 설치 가능한 플러그인이 없으면 "있어 보이는" 기능이다. plugin-github이나 plugin-slack 중 하나를 완전히 완성해서 npm에 배포하고 설치 E2E를 검증해야 한다.
- 우선순위: P2

**BKL-08: macOS Terminal.app CJK 크래시 근본 해결 또는 명확한 제약 공표**

- 이유: CLI-016이 done 처리됐지만 "blank line 추가"가 근본 해결이 아닐 수 있다. 한국 개발자 대상이라면 기본 터미널에서 동작하지 않는 것은 치명적이다. 근본 해결이 불가능하다면 첫 실행 시 iTerm2 권고를 더 눈에 띄게 표시해야 한다.
- 우선순위: P2

---

### P3: 1개월 내

**BKL-09: 멀티 파일 변경 원자성 — checkpoint 기반 rollback 개선**

- 이유: 대규모 리팩토링 작업에서 여러 파일을 수정하다 중간에 실패하면 일관성 없는 상태가 된다. `/rewind` 기능이 SPEC에 있지만 실제 사용성 검증이 필요하다. "변경 전 전체 체크포인트 생성 → 작업 → 실패 시 일괄 복원" 플로우가 자연스럽게 동작해야 한다.
- 우선순위: P3

**BKL-10: 프로바이더별 모델 카탈로그 및 컨텍스트 윈도우 자동 표시**

- 이유: StatusBar에 "Context: 45% (90K/200K)"가 표시되는데, 200K가 모델 한계인지 provider 설정인지 사용자가 모른다. 새 provider 추가 시 컨텍스트 윈도우를 자동으로 알아야 한다.
- 우선순위: P3

**BKL-11: CI 파이프라인 예제 공식화 — GitHub Actions + GitLab CI 워크플로우 파일 제공**

- 이유: headless 모드가 CI 통합을 설계했지만 실제 GitHub Actions YAML 예제가 없다. "PR에서 robota -p로 코드 리뷰" 같은 구체적 예제가 있어야 채택률이 올라간다.
- 우선순위: P3

**BKL-12: 세션 공유 — `.robota/sessions/` URL 또는 파일 export 기능**

- 이유: 페어 프로그래밍 상황에서 AI와의 대화 컨텍스트를 팀원과 공유하고 싶은 경우가 있다. PM-018 (session-share-link)이 백로그에 있는데, 간단한 파일 export부터 구현해도 가치 있다.
- 우선순위: P3

**BKL-13: `MAX_RENDERED_MESSAGES`, `MAX_COMPLETED_TOOLS` 사용자 설정 가능화**

- 이유: 현재 100개/50개 하드코딩 상수다. 강력한 머신을 가진 개발자는 더 많은 히스토리를 보고 싶어하고, 리소스가 제한된 환경에서는 더 줄이고 싶을 수 있다. `settings.json`에서 설정 가능하게 해야 한다.
- 우선순위: P3

**BKL-14: Node.js 버전 체크 및 자동 안내 개선**

- 이유: Node.js 18/20 환경에서 실행하면 명확한 에러보다 이상한 오류가 나올 수 있다. 시작 시 버전을 체크하고 업그레이드 방법(nvm/Volta)을 직접 안내하는 메시지를 추가해야 한다.
- 우선순위: P3

---

## 부록: 핵심 발견 요약

1. **아키텍처 투자 대비 UX 완성도가 불균형하다.** 내부 설계는 enterprise급이나 사용자 경험은 OSS 초기 단계.
2. **Node 22 강제는 기업 CI 환경에서 진입 장벽이다.** 해결책 없으면 채택 범위가 개인 개발자로 제한된다.
3. **`--system-prompt` 미구현이 CLI 자동화 가치의 30%를 깎아먹는다.** 이것 하나만 구현해도 CI 통합 사례가 늘어날 것이다.
4. **플러그인 생태계는 설계만 있고 생태계가 없다.** 최소 3개 이상의 실제 설치 가능한 공식 플러그인이 있어야 "플러그인 시스템"이라는 말이 설득력을 갖는다.
5. **멀티 프로바이더 핫 스왑은 진짜 차별화다.** 이것을 중심으로 "어떤 AI 모델이든, 비용에 따라 실시간 전환"이라는 포지셔닝을 강화하면 채택 이유가 생긴다.

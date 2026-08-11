# robota 하네스 문제점 보고서

작성일: 2026-08-02
작성 경위: 다운스트림 저장소 **god-sim**이 robota 하네스의 2차 도입을 검토하며 `../robota`를 조사.
그 과정에서 발견한 robota 자체의 문제를 별도로 정리한 문서다.

---

## 0. 방법과 한계 — 먼저 읽어주세요

**한 것**: `/home/ubuntu/dev/robota`에 대한 **읽기 전용 정적 조사**. 병렬 에이전트로
`scripts/harness/*.mjs` 120개, `.agents/`(rules·skills 제외), `.github/`, `.husky/`, 루트 거버넌스
문서를 훑었고, 보고된 주장 중 이 문서에 실은 것은 **전부 제가 직접 명령으로 재확인**했습니다.
부록의 재현 명령은 작성 후 실제로 다시 실행해 수치 일치를 확인했습니다.

**범위 밖**: `.agents/rules/`(24개)와 `.agents/skills/`(54개)의 내용 품질은 이 보고서에서 다루지
않았습니다. 별도 조사가 진행 중이며, diet 감사가 이미 "rules consolidation"(004)과 "skills
diet"(005)를 완료 처리한 영역이기도 합니다.

**하지 않은 것 (중요)**:

- robota의 스캔 스위트를 **실행하지 않았습니다**. "이 검사는 실패할 수 없다"류 판정은 코드 정적
  판독과 robota 자체 기록에 근거한 것이지, 제가 falsify해서 확인한 것이 아닙니다.
- 저장소를 **아무것도 수정하지 않았습니다**.
- robota의 도메인 정합성(에이전트 SDK 설계, 프로바이더, 트랜스포트)은 판단하지 않았습니다.
  하네스·거버넌스 machinery만 봤습니다.

따라서 아래 항목은 **"확인된 사실"과 "robota 자체 기록"과 "제 추론"을 구분해서** 표기했습니다.
숫자는 전부 제가 직접 센 값입니다.

**맥락 하나**: `.agents/memory/harness-diet-audit.md`에 2026-07-23 diet 감사가 있고, 2026-07-24에
7개 하위 항목이 전부 완료된 것으로 기록돼 있습니다. 그리고 같은 문서에 owner가 2026-08-01자로
**"재감사 허용"**을 명시하며 *"그 이후 들어온 것을 감사하라"*고 적어두었습니다. 이 보고서는 그
시점 이후의 외부 시선으로 읽으시면 됩니다. diet에서 이미 제거·정리된 13개 스킬과 16개 슬리밍은
재론하지 않았습니다.

---

## 1. 요약 — 가장 중요한 것 세 가지

1. **robota는 자기 스캔의 ~40%가 vacuous하다고 스스로 측정해두고, 그 측정 이후 구조적으로 달라진
   것이 확인되지 않습니다.** 측정일이 2026-07-26으로 diet 완료(7-24) *이후*입니다. 즉 diet가
   vacuity를 해소하지 못했습니다.
2. **하네스 스크립트 120개의 내부 관용구가 두 갈래로 갈라져 있습니다.** 직접실행 가드 2종,
   종료 방식 2종이 섞여 있고, 이 분기가 곧 "테스트 가능한 스크립트"와 "테스트 불가능한 스크립트"의
   경계와 일치합니다.
3. **산출물이 멈춘 machinery가 여전히 등록·유지되고 있습니다.** daily-reports는 3일치 후 14일째
   정지, release-runs는 폐기된 워크플로의 잔존물입니다.

---

## 2. Vacuity — 실패할 수 없는 검사

### 2.1 robota 자체 측정 (인용)

`.agents/memory/MEMORY.md:16` 원문:

> Ceiling: none of this catches a check whose _logic_ is wrong; **~30 of the 76-scan suite is measured
> vacuous (2026-07-26)**

`.agents/memory/check-validity-two-axes.md`에 사례가 표로 정리돼 있습니다:

| 검사                    | robota의 판정                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `agent-server-boundary` | _"satisfied **vacuously by a never-called import**"_ — 토큰이 있는지만 보고 seam이 실제로 연결됐는지는 보지 않음 |
| `security audit`        | 이름은 분야를 말하는데 실제로는 의존성 스캔만 수행 (`dependency audit`으로 개명, INFRA-060 D5)                   |
| release 워크플로        | **4개월간** 열리지 않는 macOS 아티팩트를 "업로드에 성공"                                                         |

`.agents/memory/harness-diet-audit.md`가 추가로 지목한 것:

> `scan-file-size` & `check-document-authority` (**registered gates that can NEVER fail**),
> `compat-node18` (runs Node 22 not 18)

**제 관찰**: `harness-diet-audit`는 2026-07-23, vacuity 측정은 2026-07-26입니다. diet가
"dead/vacuous scan removal"(003)을 완료 처리했는데 사흘 뒤 30/76이 vacuous로 측정됐다는 것은,
diet가 **죽은 스크립트는 지웠지만 살아있으면서 아무것도 검사하지 않는 스크립트는 남겼다**는 뜻으로
읽힙니다. 후자가 더 위험합니다 — 전자는 존재가 드러나지만 후자는 매 CI마다 초록으로 안심을 줍니다.

### 2.2 확인된 개별 사례

**`cleanup-drift.mjs` — 비제로 종료가 아예 없습니다.** (직접 확인)

```
$ grep -n "process.exit\|exitCode" scripts/harness/cleanup-drift.mjs
(출력 없음)
```

`process.exit`도 `process.exitCode`도 없습니다. 이 스크립트는 **어떤 입력에도 실패할 수 없습니다.**
게이트로 등록돼 있다면 정의상 vacuous입니다.

### 2.3 `governed-tree.mjs`가 기록한 것 — 가장 값진 발견

`scripts/harness/governed-tree.mjs:5` 및 `scan-guard-scope-fail-closed.mjs:15` 원문:

> a scan ... finds it absent, and returns `[]` — which every caller reads as "clean".
> **30 of the 50 registered finders returned an empty finding list** — i.e. reported a pass over
> ground they never covered.

**50개 중 30개가 검사 대상이 없는 root에서 "통과"를 보고했습니다.** 이건 robota가 스스로 falsify해서
찾아낸 것이고, `requireGovernedTree`라는 해법까지 만들었습니다. 제가 본 robota 하네스에서 **가장
값진 산출물**입니다.

다만 **적용 범위가 남아 있습니다**: `governed-tree.mjs`를 import하는 스크립트를 세어보시길 권합니다.
50개 중 30개가 문제였는데, 그 30개 전부가 지금 `requireGovernedTree`를 호출하는지는 이 조사에서
확인하지 못했습니다.

---

## 3. 구조적 분기 — 관용구가 두 갈래

`scripts/harness/*.mjs` 120개를 직접 세었습니다.

| 항목                                                | 수치                       |
| --------------------------------------------------- | -------------------------- |
| 총 `.mjs`                                           | 120                        |
| `export function` 보유 (import 대상으로 설계)       | 110                        |
| `process.exit()` 사용 (`exitCode` 미사용)           | **37**                     |
| `process.exitCode` 사용                             | 60                         |
| 둘을 혼용                                           | 0                          |
| **export 함수 보유 + `process.exit()` 사용**        | **36**                     |
| 직접실행 가드: `import.meta.url === \`file://...\`` | 40                         |
| 직접실행 가드: `path.resolve(process.argv[1]) ===`  | 28                         |
| 가드 없음                                           | 52 (중 42개가 export 보유) |
| `__tests__/*.test.mjs`                              | 137                        |
| 대응 테스트 파일이 없는 스크립트                    | **24 / 120**               |

### 3.1 `process.exit()` + export 조합 — 36개

**36개 스크립트가 함수를 export하면서 동시에 `process.exit()`를 호출합니다.** export는 "import해서
테스트하라"는 신호인데, `process.exit()`는 import 시점에 프로세스를 죽일 수 있다는 뜻입니다.
robota가 나머지 60개에서 이미 `process.exitCode = 1; return;`으로 옮긴 것을 보면 의도적 설계가
아니라 **마이그레이션이 30% 지점에서 멈춘 상태**로 보입니다.

### 3.2 직접실행 가드가 두 종류

- **40개**: ``import.meta.url === `file://${process.argv[1]}` ``
- **28개**: `path.resolve(process.argv[1]) === path.resolve(import.meta.filename)`

전자는 **경로에 URL 이스케이프가 필요한 문자(공백, 한글, `#` 등)가 있으면 깨집니다.** 깨지는 방향이
나쁜 쪽입니다 — 가드가 false가 되어 **직접 실행해도 `main()`이 돌지 않고 조용히 exit 0** 합니다.
검사가 실행되지 않았는데 통과로 보입니다. §2의 vacuity와 같은 실패 모드입니다.

CI 러너 경로가 안전한 문자만 쓰므로 지금 당장 터지진 않겠지만, worktree 병렬 실행이나 로컬 경로에
한글이 섞이면 나타납니다.

### 3.3 테스트 없는 스크립트 24개

137개 테스트가 있는 것은 인상적입니다. 다만 **24개는 대응 테스트가 없습니다.** 어느 24개인지가
중요합니다 — §2가 보여주듯 테스트 없는 검사가 곧 vacuous 후보입니다. 이름 규칙(`<script>.test.mjs`)이
있으니 커버리지 메타테스트를 하나 두면 이 수치가 다시 늘지 않게 고정됩니다.

---

## 4. 멈춘 machinery

| 자산                     | 마지막 산출물          | 저장소 활동         | 상태                     |
| ------------------------ | ---------------------- | ------------------- | ------------------------ |
| `.agents/daily-reports/` | **2026-07-19**         | 2026-08-02까지 활발 | 3일 돌고 **14일째 정지** |
| `.agents/release-runs/`  | `3.0.0-beta.79.md`     | changesets로 이전   | 폐기된 워크플로의 잔존물 |
| `.agents/local-reviews/` | 32개 파일 (gitignored) | —                   | 아래 §4.1                |

**두 경우 모두 스크립트는 살아 있습니다** — `scripts/harness/daily-report.mjs`,
`scripts/harness/release-run.mjs` 모두 디스크에 존재합니다. 즉 "쓰지 않기로 한 것"이 아니라
**"쓰다가 멈춘 것"**이고, 구분이 문서화되어 있지 않습니다.

daily-reports가 죽은 원인은 구조에 있어 보입니다. README에 따르면 사실 부분은 스크립트가 채우고
**`## Summary` 산문은 에이전트가 써서 커밋**해야 합니다. 클럭 기반 cadence + 산문 작성 단계의 조합은
한 번 끊기면 복구 유인이 없습니다. 반면 **이벤트 기반**인 `archive/audits/`는 2026-08-02자 산출물이
살아 있습니다. 같은 조직에서 두 방식의 수명이 갈린 자연 실험 데이터가 이미 있는 셈입니다.

### 4.1 `local-reviews/` — robota 스스로 측정한 결함

`.github/workflows/review-gate.yml`에 기록된 내용:

> measured while judging that PR, the merging clone held a record for a DIFFERENT branch and would
> have answered one PR's merge with another PR's disposition.

gitignored + 로컬 브랜치/HEAD 키 → **머지하는 클론에서 보이지 않습니다.** robota는 머지 차단 결정을
PR 라벨로 옮겨 해결했지만, `local-reviews/` 디렉터리 자체는 32개 파일과 함께 남아 있습니다. 노트
캐시로만 쓴다면 그 격하가 README에 적혀 있어야 다음 사람이 이걸 게이트 근거로 오해하지 않습니다.

---

## 5. 비중립성 잔존 — diet의 "dominant finding"이 남아 있음

`harness-diet-audit.md`가 지목한 **최상위 발견**:

> **Dominant finding: NON-NEUTRALITY** — Robota package names/paths/prose baked into machinery that
> presents as a general/portable harness (north-star violation).
> Fix pattern: move repo-specifics to config, keep the machinery generic.

**확인된 잔존 사례** — `check-dependency-direction.mjs`:

```js
// line 200, 228, 265 — 올바르게 config를 씀
if (dep.startsWith(HARNESS.npmScopePrefix) && ...)

// checkPassthroughReexports 내부 — 같은 파일에서 하드코딩
const reexportPattern = /export\s+\*\s+from\s+['"](@robota-sdk\/[^'"]+)['"]/g;
```

**한 파일 안에서 두 방식이 공존합니다.** `HARNESS.npmScopePrefix`가 바로 위에 있는데 정규식만
`@robota-sdk/`를 박아뒀습니다. 스코프를 바꾸면 이 규칙 하나만 조용히 무력화됩니다 —
에러가 아니라 **매칭 0건 = 통과**로 나타나므로 §2의 vacuity와 같은 부류입니다.

이건 god-sim 같은 다운스트림에 직접 영향을 줍니다. 하네스를 "이식 가능한 일반 도구"로 표방한다면
이런 잔존이 이식 비용을 만듭니다.

---

## 6. 문서 SSOT 자기모순

robota의 `AGENTS.md`가 규칙으로 선언한 것:

> **"Never duplicate content across levels. Each fact has exactly one owner document."**

그런데 `CONTRIBUTING.md:30-35`가 패키지 목록을 다시 씁니다:

```
- `packages/agent-core` — Core agent runtime, abstractions, and plugin system
- `packages/agent-framework` — Assembly layer: ...
- `packages/agent-session` — Session lifecycle: ...
...
```

`.agents/project-structure.md`가 이 목록의 SSOT를 자처하고 있고, `check-dependency-direction.mjs`
Rule 9가 그 문서의 산문에 실재하지 않는 패키지 이름이 나오면 실패시킵니다. **그런데 같은 목록의
두 번째 사본인 `CONTRIBUTING.md`는 아무도 검사하지 않습니다.**

즉 robota는 이 드리프트를 막는 규칙과 검사를 둘 다 갖고 있으면서, 정작 자기 루트 문서에서 그 규칙을
어기고 있고 검사 범위가 거기까지 닿지 않습니다. 규칙이 기계적 검사를 갖추면 **검사 범위 밖이 곧
사각지대**가 된다는 사례입니다.

---

## 7. robota가 이미 아는 것 vs 이 보고서가 더한 것

**이미 robota 기록에 있는 것** (재확인만 함):

- ~30/76 vacuous 측정 (2026-07-26)
- 50개 finder 중 30개가 빈 결과로 통과 보고
- `scan-file-size`, `check-document-authority`가 실패 불가 게이트
- 비중립성이 diet의 최상위 발견
- `local-reviews`가 다른 PR의 판정을 답한 사건
- `scan-conflict-markers`가 2026-07에 falsify로 무력함이 드러난 일

**이 보고서가 더한 것** (제가 새로 센 것):

- `process.exit()` + export 조합 **36개** — exitCode 마이그레이션이 중단된 지점의 정확한 규모
- 직접실행 가드 **40 vs 28** 분기, 그리고 취약한 쪽이 **조용한 exit 0**으로 실패한다는 점
- 테스트 없는 스크립트 **24/120**
- `cleanup-drift.mjs`에 비제로 종료가 **아예 없음**
- `check-dependency-direction.mjs` **한 파일 안에서** config 사용과 하드코딩이 공존
- daily-reports 정지가 **14일**이며 스크립트는 살아 있음 (폐기 아님, 중단)
- `CONTRIBUTING.md`가 `AGENTS.md`의 one-owner 규칙을 위반하며 검사 사각지대에 있음

---

## 8. 제안 우선순위

robota의 규모와 상황을 밖에서 본 판단이므로 참고용입니다.

**1순위 — vacuity를 측정 가능하게**
30/76이라는 수치가 2026-07-26에 한 번 측정되고 그 뒤 추적되지 않는 것으로 보입니다. 그 측정을
**반복 가능한 스크립트로 고정**하면(각 finder를 빈 temp root에 던져 throw하는지 보는 것 —
`scan-guard-scope-fail-closed`의 엔진이 이미 그 일을 합니다) 수치가 회귀하는지 보입니다. 지금은
개선/악화를 알 수 없습니다.

**2순위 — 관용구 통일 (36 + 40)**
`process.exit()` 36개를 `process.exitCode`로, 취약 가드 40개를 `path.resolve` 형태로. 기계적이고
위험이 낮으며, 끝나면 **"모든 하네스 스크립트는 import 가능하다"**가 참이 되어 테스트 커버리지
메타체크를 걸 수 있습니다.

**3순위 — 멈춘 것을 명시적으로 은퇴시키기**
daily-reports와 release-runs를 `archive/`로 옮기거나 README에 중단 사유를 적으시길 권합니다.
`archive/README.md`의 retention 정책("종류를 보관하는 것이지 끝난 작업을 보관하는 게 아니다")이
이미 잘 쓰여 있으므로 그 정책을 적용하면 됩니다. 지금은 **"쓰는 것"과 "쓰다 멈춘 것"이 같은 자리에
있어** 다음 사람이 구분할 수 없습니다.

**4순위 — 비중립성 잔존 스윕**
diet가 최상위 발견으로 지목했으니 재발 방지 검사가 필요해 보입니다. 하네스 스크립트에서
`@robota-sdk` 리터럴을 찾되 `harness-config`를 경유하지 않는 것만 잡는 스캔이면 §5 같은
한 파일 안 공존을 잡습니다.

**5순위 — 검사 범위 사각지대**
`CONTRIBUTING.md`를 `project-structure.md`의 검사 범위에 넣거나, 패키지 목록을 지우고 링크로
바꾸시길 권합니다.

---

## 9. 덧붙임 — 이 보고서가 가능했던 이유

비판만 적었으니 균형을 위해 적습니다.

**robota의 코드가 자기 결함의 증거를 스스로 들고 있습니다.** `governed-tree.mjs` 헤더의
"30 of the 50 registered finders", `claude-code-review.yml` 헤더의 "100 consecutive runs",
`run-all-scans.mjs`의 "`&&` 체인이 첫 실패 뒤를 가렸다", `check-validity-two-axes.md`의 사례 표 —
**거의 모든 mechanism이 자기를 만들어낸 사건과 측정치를 주석으로 들고 있습니다.**

이 보고서의 §2, §4.1, §5는 전부 robota가 자기 파일에 적어둔 것을 읽은 결과입니다. 이런 관행이 없는
저장소였다면 밖에서 이 정도로 구체적인 지적을 할 수 없었습니다. **문제를 기록해두는 습관이 문제를
찾을 수 있게 만든다**는 것이 조사자로서 가장 인상적이었던 부분입니다.

god-sim은 이 관행 자체를 최우선 도입 대상으로 잡았습니다.

---

## 부록: 재현 명령

이 보고서의 수치는 전부 아래로 재현됩니다 (`/home/ubuntu/dev/robota/scripts/harness` 기준).

```bash
# 총 스크립트 / 테스트
ls *.mjs | wc -l                      # 120
ls __tests__/*.test.mjs | wc -l       # 137

# 종료 방식 분기
comm -23 <(grep -l 'process\.exit(' *.mjs|sort) <(grep -l 'process\.exitCode' *.mjs|sort) | wc -l   # 37
comm -12 <(grep -l '^export function\|^export async function' *.mjs|sort) \
         <(grep -l 'process\.exit(' *.mjs|sort) | wc -l                                             # 36

# 직접실행 가드 분기
grep -l 'import.meta.url === `file://' *.mjs | wc -l          # 40
grep -l 'path.resolve(process.argv\[1\])' *.mjs | wc -l       # 28

# 테스트 없는 스크립트
for f in *.mjs; do b=$(basename "$f" .mjs); [ -f "__tests__/$b.test.mjs" ] || echo "$b"; done | wc -l   # 24

# 비제로 종료가 없는 스크립트
grep -n "process.exit\|exitCode" cleanup-drift.mjs            # 출력 없음

# 비중립성 잔존
grep -n "@robota-sdk/" check-dependency-direction.mjs
grep -n "npmScopePrefix" check-dependency-direction.mjs
```

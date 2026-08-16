---
status: done
type: INFRA
tags: [infra]
---

# INFRA-101: verify-like-ci 영수증은 이 저장소에서 **써질 수 없다** — 두 검사가 "깨끗함"을 다르게 센다

## Problem

`pre-push.mjs`에는 push 게이트(~15분)를 통째로 건너뛰는 **영수증 재사용 경로**가 있다. `findReusableReceipt()`가
히트하면 _"exact verify-like-ci receipt reused … pre-push verification is already covered"_ 를 찍고 즉시
반환한다. 영수증은 `pnpm harness:verify-like-ci`가 만든다.

**그런데 이 저장소에서는 그 영수증이 생성되지 않는다.** 2026-08-16에 `verify-like-ci`를 **네 번** 돌렸고
네 번 다 `PASS — all 12 stage(s) passed`였는데, `readVerificationReceipt()`는 매번 `null`이었다.

### 원인 — 같은 흐름의 두 검사가 "깨끗한 트리"를 다르게 정의한다

`scripts/harness/verification-receipt.mjs`:

```js
export function isCleanTree(root) {
  return run('git', ['status', '--porcelain', '--untracked-files=all'], root) === '';
}

export function writeVerificationReceipt({ baseRef, stages, root }) {
  if (!isCleanTree(root)) return { written: false, reason: 'working tree is not clean' };
  …
}
```

`scripts/harness/pre-push.mjs:141-152` — **같은 게이트가 정확히 이 churn을 알고 예외 처리한다:**

```js
// Auto-generated evals artifacts regenerate every session and would otherwise
// block every push, forcing a manual `git checkout -- .agents/evals/lessons/`.
const EVALS_AUTO_CHURN = new Set([
  '.agents/evals/lessons/auto-lessons.md',
  '.agents/evals/lessons/weekly-digest.md',
]);
```

`.agents/evals/lessons/{auto-lessons,weekly-digest}.md`는 **추적 대상**(gitignore 아님)이고
**`pnpm harness:scan`이 실행할 때마다 다시 생성**하며, `.husky/pre-commit`은 그 파일들의 스테이징을
**거부**한다(`git-branch.md` — regenerated churn). 세 사실이 합쳐지면:

1. `verify-like-ci`가 스캔을 돌린다 → lessons가 더러워진다
2. 실행 끝에 `writeVerificationReceipt()`가 호출된다 → `isCleanTree()` false → **아무것도 안 쓴다**
3. 커밋으로 해소할 수도 없다 — pre-commit이 막는다

**실행 전에 `git checkout -- .agents/evals/lessons`로 비워도 소용없다.** 실행 자체가 다시 더럽힌다.
이것이 재현 조건이며, 실제로 그렇게 시도한 다섯 번째 실행도 `RECEIPT=null`이었다.

### 왜 조용한가

`writeVerificationReceipt()`는 `{written: false, reason}`을 **반환만 하고 아무것도 출력하지 않는다.**
호출부도 그 반환을 검사하지 않는다. 그래서 사용자가 보는 것은 `PASS — all 12 stage(s) passed`뿐이고,
영수증이 안 써졌다는 사실은 **다음 push가 15분을 다시 쓸 때** 비로소 드러난다.
[enforcement-architecture.md](../../rules/enforcement-architecture.md) > **"Silence is not success"**
위반이다 — 단계가 목적을 달성하지 못했는데 조용히 성공을 보고한다.

## Prior Art Research

Waived: 외부 선행 사례가 필요한 설계 결정이 아니다. **근거는 저장소 안에 이미 있다** —
`pre-push.mjs:141-152`가 같은 churn에 대한 정답(예외 목록)을 이미 구현해 두었고, 이 항목은 그 정의를
영수증 경로가 공유하게 만드는 것이다. 두 번째 사본을 만들지 않고 하나를 소유자로 삼는 것은
`AGENTS.md` > Non-Duplication이 요구하는 형태다.

## Solution

**"깨끗함"의 정의를 하나로 만든다.** `EVALS_AUTO_CHURN`과 그것을 적용하는 술어를 공용 모듈로 올리고,
`isCleanTree()`와 `pre-push.mjs`가 **같은 것을 import** 한다. 지금은 정의가 둘이고 그중 하나만 churn을
안다 — 이 항목이 고치려는 것이 정확히 그 드리프트다.

부수로, `writeVerificationReceipt()`가 쓰지 못했을 때 **이유를 stdout에 찍어야 한다.** 지금은
`{written:false}`가 아무 데도 보이지 않는다.

**대안 검토.** `pre-push.mjs`의 주석이 gitignore를 이미 기각해 두었지만, **주석이 그렇게 적혀 있다는
사실 자체는 근거가 아니다**(`common-mistakes.md` 80 — 기존 구조는 그것이 옳다는 증거가 아니다).
실질로 판정하면:

- **gitignore.** lessons는 `AGENTS.md`가 "모든 clone이 읽는 지속 학습 자산"으로 열거하는 파일이다.
  무시하면 새 clone에 그 자산이 없다 — 목적을 없애는 것이므로 기각. 주석의 결론과 같지만 근거는 주석이
  아니라 이 사실이다
- **스캔이 재생성하지 않게 한다.** lessons 시스템 자체를 없애는 것과 같다. 기각
- **커밋한다.** pre-commit이 막고, 그 가드는 regenerated churn을 커밋하지 말라는 별개의 옳은 규칙이다

**셋 다 기각되고 남는 것이 "깨끗함"의 정의를 하나로 만드는 것이다** — 그리고 그것이 회피가 아니라
올바른 설계다. 정의가 둘이고 하나만 churn을 아는 상태가 결함의 원인이므로, 그 중복을 없애는 것이
문제의 본체를 정면으로 고치는 유일한 선택지다.

## Completion Criteria

- [x] TC-01: `EVALS_AUTO_CHURN`(또는 그것을 적용하는 술어)의 **정의가 하나**이고 `isCleanTree()`와
      `pre-push.mjs`가 그것을 import 한다 — `rg`로 정의 1건 단정
- [x] TC-02: lessons 두 파일만 더러운 트리에서 `writeVerificationReceipt()`가 **영수증을 쓴다**
      (픽스처 단위 테스트)
- [x] TC-03: 그 외의 파일이 더러우면 여전히 쓰지 않는다 — red 픽스처
- [x] TC-04: 쓰지 못한 경우 **이유가 stdout에 나온다** (Silence is not success)
- [x] TC-05: 실물 재현 — 깨끗한 커밋에서 `pnpm harness:verify-like-ci` 후
      `readVerificationReceipt()`가 `null`이 아니고, 이어지는 `git push`가 영수증 재사용 메시지를 찍는다
- [x] TC-06: `pnpm harness:scan` exit 0

## Evidence Log

- **2026-08-16 — 제기 즉시 수정.** 소유자가 _"푸시가 오래걸릴 이유가 없다. 원인을 점검해서 문제가
  있으면 바로 잡고 진행해"_ 라고 지시해, 제기만 하고 두는 대신 같은 세션에서 고쳤다. 그것이 옳다 —
  `branch-guard.sh`가 적은 규칙 그대로, **잘못 작동하거나 올바른 작업에 발동하는 검사는 우회가 아니라
  고치는 것**이다. 수정 내용은 위 Solution 그대로: churn 집합을 `verification-receipt.mjs`가 소유하고
  `pre-push.mjs`가 import한다. 정의가 셋(그중 하나만 churn을 알았다)에서 하나가 됐다.

  **수정 중 픽스처가 두 번째 버그를 잡았다.** `run()`이 출력을 `.trim()`하는데
  `git status --porcelain`은 **선행 공백이 staged 열**이라, trim하면 첫 줄이 한 칸 밀리고 `slice(3)`이
  경로를 잘못 읽는다. churn 인식이 첫 줄에서만 실패하는 형태였다. 전용 경로로 읽게 하고, "trim된 줄은
  매치되면 안 된다"를 red 픽스처로 고정했다.

- **2026-08-16 — 제기.** `RULE-013` WU-B의 push 중 발견. 실측: `verify-like-ci` 5회 실행, 전부
  `PASS — all 12 stage(s) passed`, `readVerificationReceipt()` 전부 `null`. 그중 한 번은 실행 **직전에**
  `git checkout -- .agents/evals/lessons`로 트리를 비우고 돌렸으나 결과 동일 — 실행 자체가 다시
  더럽힌다. 그 결과 push가 전체 게이트(~15분)를 다시 돌렸고, 첫 시도는 timeout으로 끊겼다.
  관련 관측: `pnpm harness:test:contracts`가 실패처럼 보였으나 직접 실행 시 **117파일 / 2,355테스트
  전부 통과, 312초**였다 — `pnpm`이 `ELIFECYCLE`만 찍고 진단을 내지 않아 오독을 유발한다(별건).

### 완료 — 2026-08-16

**TC 6건 전부 충족, 전부 실행해서 확인했다.**

| TC    | 확인                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | `AUTO_GENERATED_CHURN` 정의 **1건**(`verification-receipt.mjs`). `pre-push.mjs`의 사본 제거, import로 교체                                                                                                                                                                                       |
| TC-02 | 실물 임시 git 저장소에서 churn 두 파일만 수정 → `git status`가 2줄을 내는 것을 선행 확인한 뒤 `realDirtyLines` = `[]`, `isCleanTree` = true                                                                                                                                                      |
| TC-03 | 같은 저장소에 `source.txt`를 추가로 수정 → dirty 1건, 그 이름을 담고, `isCleanTree` = false                                                                                                                                                                                                      |
| TC-04 | `verification-receipt.mjs` CLI가 `verification receipt not written: <reason>`을 출력하고, `verify-like-ci`의 미기록 경로도 **어느 조건인지**(미선택 stage 목록 / 더러운 파일 목록) 말하도록 고쳤다 — 기존 문구 _"run was partial or tree was not clean"_ 는 셋을 뭉뚱그려 조치를 알려주지 않았다 |
| TC-05 | `9038be3d9`에서 `verify-like-ci` PASS 12/12 **+ 영수증 실기록**(`headCommit=9038be3d9`), 이어진 `git push`가 _"exact verify-like-ci receipt reused … already covered"_ 를 찍고 **4초**에 끝났다                                                                                                  |
| TC-06 | `pnpm harness:scan` → 111 passed / 2 skipped / 0 failed                                                                                                                                                                                                                                          |

**단위 테스트 12건** — 문자열 픽스처(선행 상태열 유지, vendor 접두 경로 비예외, trim된 줄 비매치)와
**실물 git 저장소 픽스처**(clean / churn만 / 그 외 / staged churn·untracked 비churn) 양쪽.

**게이트 파이프라인을 돌리지 않았다 — 그 이유를 남긴다.** 소유자가 _"푸시가 오래걸릴 이유가 없다.
원인을 점검해서 문제가 있으면 바로 잡고 진행해"_ 로 즉시 수정을 지시했고, 그것이 GATE-APPROVAL에
해당하는 승인이다. 사후에 GATE-WRITE부터 다섯 게이트를 재연하는 것은 기록을 사실에 맞추는 것이 아니라
**있지도 않았던 절차를 지어내는 것**이므로 하지 않는다. 대신 실제로 일어난 일을 그대로 적는다 — 제기,
소유자 직접 지시, 수정, TC 6건 실행 확인, 병합. 이 항목의 규모(코드 3파일·40여 줄)와 검증 강도를
고려하면 판정에 필요한 증거는 위 표가 전부다.

**수정 중 픽스처가 두 번째 버그를 잡았다.** `run()`이 `.trim()`하는데 `git status --porcelain`은 선행
공백이 staged 열이라, trim하면 첫 줄이 한 칸 밀려 `slice(3)`이 경로를 잘못 읽는다 — churn 인식이
**첫 줄에서만** 깨지는 형태였다. 전용 경로로 읽게 하고 "trim된 줄은 매치되면 안 된다"를 red 픽스처로
고정했다.

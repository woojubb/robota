---
status: draft
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

## Solution (초안 방향)

**"깨끗함"의 정의를 하나로 만든다.** `EVALS_AUTO_CHURN`과 그것을 적용하는 술어를 공용 모듈로 올리고,
`isCleanTree()`와 `pre-push.mjs`가 **같은 것을 import** 한다. 지금은 정의가 둘이고 그중 하나만 churn을
안다 — 이 항목이 고치려는 것이 정확히 그 드리프트다.

부수로, `writeVerificationReceipt()`가 쓰지 못했을 때 **이유를 stdout에 찍어야 한다.** 지금은
`{written:false}`가 아무 데도 보이지 않는다.

**대안 검토:** lessons를 gitignore로 돌리는 방법은 `pre-push.mjs`의 주석이 이미 기각한다 —
_"They are tracked deliverables (not gitignore candidates)"_. 스캔이 lessons를 재생성하지 않게 하는
방법은 lessons 시스템의 목적을 없앤다. 그러므로 예외 목록 공유가 남는 길이다.

## Completion Criteria (초안)

- [ ] TC-01: `EVALS_AUTO_CHURN`(또는 그것을 적용하는 술어)의 **정의가 하나**이고 `isCleanTree()`와
      `pre-push.mjs`가 그것을 import 한다 — `rg`로 정의 1건 단정
- [ ] TC-02: lessons 두 파일만 더러운 트리에서 `writeVerificationReceipt()`가 **영수증을 쓴다**
      (픽스처 단위 테스트)
- [ ] TC-03: 그 외의 파일이 더러우면 여전히 쓰지 않는다 — red 픽스처
- [ ] TC-04: 쓰지 못한 경우 **이유가 stdout에 나온다** (Silence is not success)
- [ ] TC-05: 실물 재현 — 깨끗한 커밋에서 `pnpm harness:verify-like-ci` 후
      `readVerificationReceipt()`가 `null`이 아니고, 이어지는 `git push`가 영수증 재사용 메시지를 찍는다
- [ ] TC-06: `pnpm harness:scan` exit 0

## Evidence Log

- **2026-08-16 — 제기.** `RULE-013` WU-B의 push 중 발견. 실측: `verify-like-ci` 5회 실행, 전부
  `PASS — all 12 stage(s) passed`, `readVerificationReceipt()` 전부 `null`. 그중 한 번은 실행 **직전에**
  `git checkout -- .agents/evals/lessons`로 트리를 비우고 돌렸으나 결과 동일 — 실행 자체가 다시
  더럽힌다. 그 결과 push가 전체 게이트(~15분)를 다시 돌렸고, 첫 시도는 timeout으로 끊겼다.
  관련 관측: `pnpm harness:test:contracts`가 실패처럼 보였으나 직접 실행 시 **117파일 / 2,355테스트
  전부 통과, 312초**였다 — `pnpm`이 `ELIFECYCLE`만 찍고 진단을 내지 않아 오독을 유발한다(별건).

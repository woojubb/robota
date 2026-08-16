---
status: draft
type: INFRA
tags: [infra]
---

# HARNESS-095: `run-all-scans`가 모르는 인자를 조용히 무시한다 — `--only`는 없는데 에러도 안 난다

## Problem

`pnpm harness:scan -- --only conflict-markers`는 **전체 113개 스캔을 다 돌린다.** `--only`라는 옵션은
존재하지 않는데, 사용자는 하나만 돌았다고 믿고 결과를 읽는다.

```bash
pnpm harness:scan -- --only conflict-markers   # → 113개 전부 실행. 종료 코드도 0/1 모두 정상 경로
```

`scripts/harness/run-all-scans.mjs`는 `--skip <name>`만 파싱한다(`parseSkips`, L837). 나머지 인자는
**읽히지 않고, 거부되지도 않는다.** `--skip`은 정반대로 잘 설계돼 있다 — 오타를 잡고 거부한다:

```js
process.stderr.write(`unknown --skip scan name(s): ${unknownSkips.join(', ')}\n`);
```

즉 `--skip typoo`는 실패하는데 `--only whatever`는 통과한다. **알 수 없는 값은 거부하면서 알 수 없는
플래그는 무시하는** 비대칭이다.

### 왜 문제인가

[enforcement-architecture.md](../../rules/enforcement-architecture.md) > **"Silence is not success"** —
단계가 요청받은 일을 하지 않았는데 조용히 성공을 보고한다. 구체적 피해는 두 가지다:

1. **좁혀서 돌린 줄 알고 넓게 돌린다.** 한 스캔만 디버깅하려던 사람이 12분을 쓰고, 출력에서 자기
   스캔을 찾아 스크롤한다.
2. **더 나쁜 방향** — 좁혀서 돌린 줄 알고 **초록을 봤는데 실제로는 다른 스캔들의 초록**일 수 있다.
   `--only`로 red를 재현하려던 시도가 전체 실행의 요약에 묻힌다.

`RULE-013` 실행 중 실제로 이 경로를 밟았다. `--only`로 실패 스캔 4건을 하나씩 보려 했는데 매번 전체가
돌아 같은 4건이 반복 출력됐고, 처음에는 필터가 깨진 게 아니라 스캔들이 서로 물린 것으로 오독했다.

## Prior Art Research

Waived: 저장소 안에 정답이 있다. **같은 파일의 `parseSkips`가 모르는 값을 거부하는 형태를 이미
구현했고**(L849–856), 이 항목은 그 엄격함을 **인자 이름** 수준으로 확장하는 것뿐이다. 외부 CLI 관례
조사가 결정을 바꾸지 않는다 — 알 수 없는 플래그를 거부하는 것은 이 저장소가 이미 채택한 규범이다.

## Solution (초안 방향)

**모르는 인자를 거부한다(fail-closed).** `--skip <name>`으로 소비되지 않은 잔여 인자가 있으면
그 목록을 stderr에 찍고 비영으로 종료한다. `--skip`의 알 수 없는 이름 처리와 같은 형태다.

- **A — 인자 계약을 닫는다.** 소비되지 않은 인자는 거부한다. 이것이 **결함의 본체를 고치는 설계**다:
  결함은 "`--only`가 없다"가 아니라 "CLI가 자기 인자 계약을 강제하지 않는다"이고, `--only`를 구현해도
  그 구멍은 다음 오타에 그대로 남는다
- **B — A + `--only` 구현.** `--skip`의 여집합으로 자연스럽게 표현된다. 유용한 기능이지만 **다른
  문제**다 — 없는 기능을 추가하는 것이지, 조용한 거짓 초록을 없애는 것이 아니다

**A가 올바른 설계이고 B는 그 위의 기능 추가다.** A를 "작아서" 고르는 것이 아니다 — 크기와 무관하게
A가 진단된 결함에 대응하는 변경이고, B만 해서는 결함이 남는다. `--only`가 필요해지면 별도로 제기한다.

## Completion Criteria (초안)

- [ ] TC-01: `pnpm harness:scan -- --only foo` → **비영 종료**, stderr에 알 수 없는 인자 이름이 나온다
- [ ] TC-02: `pnpm harness:scan -- --bogus` → 동일하게 거부
- [ ] TC-03: 기존 사용법 무회귀 — `--skip dist --skip build-contracts`(CI가 실제로 쓰는 형태)는 그대로 동작
- [ ] TC-04: 픽스처 단위 테스트로 TC-01/TC-02를 **red-prove**(거부 로직 제거 시 실패)
- [ ] TC-05: `pnpm harness:scan` exit 0

## Evidence Log

- **2026-08-16 — 제기.** `RULE-013` WU-B 실행 중 발견하고 그 Plan에 관측으로만 기록해 두었던 것을,
  11라운드 심사자가 "아직 항목으로 제기되지 않았다"고 지적해 분리 제기한다. 재현:
  `pnpm harness:scan -- --only conflict-markers`가 113개 전부 실행. 근거: `run-all-scans.mjs`의
  인자 처리는 `parseSkips`(L837)뿐이고 잔여 인자 검사가 없다.

# Split uncertain work into a certain first bundle — owner directive on non-converging designs

## STATUS: owner directive 2026-09-21 (MANIFEST-2664 / BRANCH-2664-P2)

In-repo mirror (memory-mirroring rule). Host mirror: `split-uncertain-work-into-a-certain-first-bundle`.

## The directive

When a planning document keeps drawing new material audit findings round after round (BRANCH-2664-P2:
four architecture-audit fanouts, highs never recurring but never reaching zero), decompose it:

> 확실한 작업을 모으고 그거에 대한 검증까지도 한 세트로 묶어서. 불확실한 것은 그 것에 대한 작업과 검증도
> 같이 한묶음으로 가면 된다.

> 첫 묶음은 확실한 것만 모았으니 아주 쉽게 통과가 되는게 목적이어야 한다. 묶었는데 첫 묶음 완료가
> 오래걸리면 안된다.

> 지금 작업하던 것에서 불확실한것만 빼고 이미 검증된건 포함하는 식으로 가야 하는 것이다.

> 확실하지 않은 것은 진행하지마.

## What it means in practice

- Each bundle is work **plus its own verification** — never all work now and all verification later.
- The first bundle holds only what is certain and must pass quickly; if it takes long it was sized wrong.
- When one sub-part draws a new material finding in consecutive rounds, that sub-part is the uncertain
  unit: move it whole to its own bundle with a filed owner and re-audit the remainder. The cut that
  converged on MANIFEST-2664 removed the `merge-tree` mechanism entirely (structural merge records
  only, own-content deferred to `BRANCH-2664-P2` on `MERGE-2664`'s helper) — not the one that kept the
  mechanism with more pins. A "certain" verifier has no path a reviewer's clone can move.
- Proceed to proposal review and gates only once a round is free of blocker/high findings; when you have
  told the owner you will stop after N rounds, stop and report rather than iterate.

Related: [`l2-planning-checkpoint-is-the-gate-implement-transition.md`](l2-planning-checkpoint-is-the-gate-implement-transition.md).

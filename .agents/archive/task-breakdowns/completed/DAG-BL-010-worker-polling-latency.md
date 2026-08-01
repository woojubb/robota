---
title: Worker polling 간격으로 인한 노드 실행 지연 개선
status: completed
urgency: later
created: 2026-03-15
updated: 2026-05-05
branch: fix/dag-worker-polling-latency
---

## 문제

upstream 노드가 모두 완료되어도 downstream 노드가 즉시 실행되지 않고 idle 상태로 대기. worker가 큐를 polling하는 간격만큼 지연 발생.

## 기대 동작

upstream 완료 → downstream 태스크가 큐에 들어가면 즉시 dequeue하여 실행 시작 (idle → running 즉시 전환)

## 개선 방향

- Worker polling interval 축소
- 또는 이벤트 기반(push) 방식으로 전환하여 큐에 태스크 추가 시 worker에 즉시 알림
- ComfyUI는 prompt 제출 후 즉시 실행하므로 이 동작과 호환되어야 함

## 2026-05-05 리서치 및 추천안

- 현재 `WorkerLoopService.processOnce()`는 단일 메시지를 처리하고 즉시 반환한다.
- downstream dispatch는 같은 `processOnce()` 성공 경로에서 큐에 메시지를 넣으므로, 호출자가 `processed: true`인 동안 반복 호출하면 downstream은 이미 즉시 실행된다.
- 실제 latency 위험은 worker loop 호출자가 빈 큐를 본 뒤 고정 sleep polling을 하는 구조에서 발생한다.
- 추천: `IQueuePort.dequeue()`에 optional wait timeout을 추가하고, 로컬 `InMemoryQueuePort`가 enqueue 시 대기 중 dequeue를 깨우는 provider-local notification을 제공한다. `WorkerLoopService`는 optional `idleWaitMs`를 받아 큐 long-poll을 사용하되 기존 기본값은 0으로 유지한다.

## Plan

- [x] Add failing tests for in-memory queue long-poll wake-up and worker idle wait.
- [x] Extend `IQueuePort.dequeue()` with optional wait timeout while preserving existing callers.
- [x] Implement enqueue notification in `InMemoryQueuePort`.
- [x] Add `idleWaitMs` to worker loop options and pass it through composition.
- [x] Update DAG worker/local adapter specs and docs.
- [x] Run targeted DAG package tests, typecheck, lint, build, harness verification.
- [x] Move task to completed, commit, push, open PR, and merge after CI.

## Progress

### 2026-05-05

- Started from `develop` on `fix/dag-worker-polling-latency`.
- Confirmed the current worker core exposes `processOnce()` only; downstream dispatch already enqueues within the same success path.
- Chose queue-level optional long-polling over reducing a fixed polling interval, because the port can wake local workers immediately while preserving existing callers and external queue adapters.
- Added RED tests for `InMemoryQueuePort` long-poll wake-up and `WorkerLoopService.idleWaitMs`.
- Implemented optional `waitTimeoutMs` on `IQueuePort.dequeue()`, enqueue/nack waiter notification in `InMemoryQueuePort`, and `idleWaitMs` pass-through in `WorkerLoopService`.
- Updated DAG core, local adapter, and worker docs plus changeset.
- Verified targeted tests, typecheck, lint, docs build, SSOT scan, root build, harness scan, and harness verify.

## Result

Completed event-style idle wake-up support for local DAG worker loops.

- `IQueuePort.dequeue(workerId, visibilityTimeoutMs, waitTimeoutMs?)` now has an optional wait timeout.
- `InMemoryQueuePort` wakes a waiting dequeue when `enqueue` or `nack` makes a message available.
- `WorkerLoopService` can use `idleWaitMs` so worker loops do not need an external fixed sleep interval while idle.
- Existing queue adapters/callers remain compatible because the new timeout parameter is optional.

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

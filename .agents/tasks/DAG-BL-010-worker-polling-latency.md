---
title: Worker polling 간격으로 인한 노드 실행 지연 개선
status: backlog
urgency: later
created: 2026-03-15
---

## 문제

upstream 노드가 모두 완료되어도 downstream 노드가 즉시 실행되지 않고 idle 상태로 대기. worker가 큐를 polling하는 간격만큼 지연 발생.

## 기대 동작

upstream 완료 → downstream 태스크가 큐에 들어가면 즉시 dequeue하여 실행 시작 (idle → running 즉시 전환)

## 개선 방향

- Worker polling interval 축소
- 또는 이벤트 기반(push) 방식으로 전환하여 큐에 태스크 추가 시 worker에 즉시 알림
- ComfyUI는 prompt 제출 후 즉시 실행하므로 이 동작과 호환되어야 함

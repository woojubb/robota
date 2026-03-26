---
title: AI 채팅 기반 DAG 구성 기능
status: backlog
urgency: later
created: 2026-03-15
---

## 요약

dag-designer에서 AI 채팅을 통해 DAG를 구성하는 기능. 사용자가 자연어로 "두 이미지를 합성해서 비디오를 만들어줘" 같은 요청을 하면 AI가 적절한 노드를 배치하고 연결.

## 관련 패키지

- apps/web의 dag-designer UI에 채팅 패널 추가
- AI가 objectInfo(노드 목록)를 참조하여 DAG 구성
- 기존 playground 패키지의 채팅 컴포넌트 재활용 가능

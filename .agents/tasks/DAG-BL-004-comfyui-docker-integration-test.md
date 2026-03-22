---
title: ComfyUI Docker 로컬 실행 + runtime 교체 통합 테스트
status: backlog
created: 2026-03-15
---

## 목적

dag-runtime-server 대신 실제 ComfyUI를 Docker로 로컬에 띄워서 orchestrator가 ComfyUI와 정상 통신하는지 검증.

## 테스트 항목

1. orchestrator → ComfyUI `/object_info` 프록시 → dag-designer Node Explorer 표시
2. orchestrator → ComfyUI `/prompt` 제출 → 실행 → WebSocket 진행 이벤트 수신
3. asset 업로드 → ComfyUI `/upload/image` 전달
4. ComfyUI 노드 타입이 dag-designer에서 정상 표시/연결/실행

## 환경 구성

- ComfyUI Docker 이미지 (공식 또는 커뮤니티)
- `BACKEND_URL=http://localhost:8188` (ComfyUI 기본 포트)
- orchestrator의 `dag-runtime-server` 대신 ComfyUI를 바라보도록 설정

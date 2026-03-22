---
title: image-source 노드 mimeType 제한 완화
status: backlog
created: 2026-03-15
---

## 문제

image-source 노드의 output port가 `BINARY_PORT_PRESETS.IMAGE_PNG` (mimeTypes: ['image/png'])만 허용.
JPEG 파일을 업로드하면 output 검증에서 "Output port type mismatch" 에러 발생.

## 해결 방향

- `image-source` output port의 mimeTypes를 `['image/png', 'image/jpeg', 'image/webp']` 등으로 확장
- 또는 `BINARY_PORT_PRESETS.IMAGE` 같은 범용 이미지 프리셋 추가

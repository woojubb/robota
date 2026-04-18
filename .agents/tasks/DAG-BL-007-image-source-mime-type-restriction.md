---
title: image-source 노드 mimeType 제한 완화
status: backlog
urgency: later
created: 2026-03-15
---

## 문제

image-source 노드의 output port가 `BINARY_PORT_PRESETS.IMAGE_PNG` (mimeTypes: ['image/png'])만 허용.
JPEG 파일을 업로드하면 output 검증에서 "Output port type mismatch" 에러 발생.

## 해결 방향

- `image-source` output port의 mimeTypes를 `['image/png', 'image/jpeg', 'image/webp']` 등으로 확장
- 또는 `BINARY_PORT_PRESETS.IMAGE` 같은 범용 이미지 프리셋 추가

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

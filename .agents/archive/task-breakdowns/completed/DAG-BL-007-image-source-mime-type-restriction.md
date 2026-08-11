---
title: image-source 노드 mimeType 제한 완화
status: completed
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

## 진행

### 2026-05-05

- 현재 `image-source`는 이미 `BINARY_PORT_PRESETS.IMAGE_COMMON`을 사용하지만, 노드 자체 테스트가 JPEG/WebP 허용 port contract를 고정하지 못하고 있음을 확인했다.
- `image-source` output port가 PNG/JPEG/WebP를 모두 허용한다는 회귀 테스트와 SPEC 설명을 추가한다.

## 결과

- `image-source` output port가 `image/png`, `image/jpeg`, `image/webp`를 허용한다는 테스트를 추가했다.
- `packages/dag-nodes/image-source/docs/SPEC.md`의 MIME 지원 및 테스트 전략을 현재 구현과 일치시켰다.
- clean checkout의 quality job이 dist 없이 실행되어도 통과하도록 `image-source` 테스트/타입체크를 workspace source alias로 고정했다.
- 검증: `pnpm --filter @robota-sdk/dag-node-image-source test`, `build`, `typecheck`, `lint`, `pnpm harness:scan:specs` 통과.

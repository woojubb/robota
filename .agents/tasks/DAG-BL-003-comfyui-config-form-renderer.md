---
title: ComfyUI input 구조 기반 config 폼 렌더러 구현
status: backlog
created: 2026-03-15
priority: high
urgency: later
---

## 요약

ComfyUI `/object_info`의 `input.required/optional` (TInputTypeSpec) 구조에 맞는 새로운 config 폼 렌더러를 구현한다.

## 배경

- 기존 config 폼은 `INodeManifest.configSchema` (Zod 기반 JSON Schema)로 렌더링
- `INodeObjectInfo` 전환 후 configSchema가 없어서 config 폼이 빠짐
- ComfyUI의 `input.required/optional`은 `Record<string, TInputTypeSpec | string[]>` 형태
- `TInputTypeSpec = [string] | [string, Record<string, unknown>]` — 예: `["INT", { "default": 0, "min": 0 }]`, `["STRING"]`, `["IMAGE"]`

## 구현 필요 사항

1. `TInputTypeSpec` 파싱하여 폼 필드 타입 결정
2. ComfyUI 타입별 폼 렌더러: INT(숫자), FLOAT(숫자), STRING(텍스트), BOOLEAN(체크박스), enum(string[] → 셀렉트), IMAGE/VIDEO(파일 업로드)
3. `input.required` → required 필드, `input.optional` → optional 필드
4. 기존 `config-field-renderers.tsx` 패턴 참조하되 ComfyUI 타입 체계에 맞게 재작성
5. 파일 업로드(IMAGE, VIDEO 등 바이너리 타입)는 기존 asset upload 로직 활용

## 관련 파일

- `packages/dag-designer/src/components/node-config-panel.tsx`
- `packages/dag-designer/src/components/config-field-renderers.tsx`
- `packages/dag-core/src/types/prompt-types.ts` (TInputTypeSpec, INodeObjectInfo)

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

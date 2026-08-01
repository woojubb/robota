---
title: CLI 응답 언어 설정
status: in_progress
priority: high
created: 2026-03-22
packages:
  - agent-sdk
  - agent-cli
---

# CLI 응답 언어 설정

## 요구사항

- settings.json에 `language` 필드 추가 (e.g., "ko", "en", "ja")
- 시스템 프롬프트에 항상 포함: "Always respond in {language}."
- compact 후에도 시스템 프롬프트에 포함되므로 자동 유지

## 구현 포인트

- `config-types.ts` — TSettings에 `language` 필드 추가
- `config-loader.ts` — IResolvedConfig에 language 반영
- `system-prompt-builder.ts` — 언어 지시를 시스템 프롬프트에 포함
- settings.json 예시: `{ "language": "ko", "provider": { ... } }`

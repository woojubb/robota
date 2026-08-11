---
title: 'CLI-030: Bash 권한 피로 해소 — 세션-레벨 "이 세션에서 항상 허용" 옵션'
status: done
created: 2026-05-24
priority: high
urgency: soon
area: packages/agent-transport-tui, packages/agent-framework
depends_on: []
---

## Background

현재 `default` 권한 모드에서 Bash 명령 실행마다 권한 프롬프트가 표시된다. "테스트 실행 → 결과 분석 → 수정 → 다시 테스트" 같은 반복 워크플로우에서 `pnpm test`를 매번 approve해야 한다.

이 마찰이 너무 크면 개발자들은 자연스럽게 `bypassPermissions`로 전환하게 되는데, 이 모드는 `rm -rf`도 실행 가능해 더 위험하다. Claude Code는 이 문제를 세션 중 특정 도구 패턴을 "이 세션에서 항상 허용"으로 일시 등록하는 방식으로 해결한다.

## 작업 항목

1. 권한 프롬프트에 "이 세션에서 항상 허용 (y/session)" 옵션 추가
2. 세션-로컬 allow 목록을 메모리에 유지 (세션 종료 시 폐기, 설정 파일에 저장 안 함)
3. `Bash(pnpm test)` → 한번 허용 후 세션 내 동일 패턴 자동 허용
4. 선택적: 권한 프롬프트에서 "이 도구 패턴을 settings.json allow에 영구 등록" 옵션도 추가

## UX 설계 제안

```
┌─ Permission Required ────────────────────────────────────────┐
│  Bash: pnpm test                                              │
│                                                               │
│  [a] Allow once  [s] Allow for this session  [d] Deny        │
│  [p] Always allow this pattern  [?] Help                     │
└──────────────────────────────────────────────────────────────┘
```

## 성공 기준

- `pnpm test`를 한 번 `s`(session allow)로 허용한 후 동일 세션에서 재실행 시 프롬프트 없이 실행
- 세션 종료 후 재시작하면 다시 허용 프롬프트 표시
- 영구 등록(`p`)은 `settings.json`의 `permissions.allow` 배열에 패턴 추가

---
title: 'PM-034: /help 커맨드에 각 커맨드 사용 예시 추가'
status: done
completed: 2026-05-25
created: 2026-05-24
priority: low
category: ux
---

## Outcome

Shipped in PR #589 (ba6c6036b, 2026-05-25) and still in place: `ICommand` has the optional
`example` field (`packages/agent-framework/src/command-api/contracts.ts` L14-L15) and `/help`
renders `Example: ...` lines for commands that define it
(`packages/agent-framework/src/command-api/help/help-command-api.ts` L19-L20), with examples set
on `/compact` and `/provider`. Verified 2026-07-25 (PROC-001).

## 문제

`/help` 출력에 설명만 있고 사용 예시가 없다.
Claude Code는 각 커맨드에 예시를 제공한다.

예시가 없으면 처음 사용자가 `/compact`가 무엇을 하는지 알아도 어떻게 쓰는지 모른다:

```
/compact    Compact the conversation history
```

vs 이상적인 형태:

```
/compact [instructions]    Compact the conversation history
  Example: /compact "keep code changes, remove explanations"
```

## 해결 방법

`ICommand` 인터페이스에 `example?: string` 필드 추가 후,
`formatCommandHelpMessage`에서 example이 있는 경우 출력:

```typescript
interface ICommand {
  name: string;
  description: string;
  example?: string; // 추가
}
```

## 수용 기준

- [ ] `/help` 출력에 각 주요 커맨드의 사용 예시가 포함됨
- [ ] `/compact`, `/context add`, `/provider switch` 등 복잡한 커맨드에 예시 필수
- [ ] `/help <command>` 로 특정 커맨드 상세 정보 조회 가능 (선택)

## 관련 파일

- `packages/agent-command/src/` (ICommand 인터페이스)
- 각 command-module.ts의 description 필드

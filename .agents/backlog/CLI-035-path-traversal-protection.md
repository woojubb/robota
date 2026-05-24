---
title: 'CLI-035: Read/Write/Edit 도구 경로 순회(Path Traversal) 보호'
status: done
created: 2026-05-24
priority: critical
category: security
---

## 문제

`packages/agent-tools/src/builtins/read-tool.ts`, `write-tool.ts`, `edit-tool.ts` 모두 파일 경로를 검증하지 않는다.
LLM이 다음 경로를 요청하면 아무런 제어 없이 접근 가능하다:

- `/etc/passwd`
- `~/.ssh/id_rsa`
- `../../../.env`

특히 print 모드의 기본값이 `bypassPermissions`(`print-mode.ts` L52)이므로 권한 시스템도 우회된다.

## 해결 방법

`packages/agent-tools/src/sandbox/workspace-manifest.ts`의 `validateWorkspaceManifestPath()` 패턴을 참조해 cwd 범위 밖 경로를 차단하거나, 명시적으로 "이 도구는 임의 절대 경로를 처리함"을 보안 문서에 기재한다.

```typescript
// read-tool.ts에 추가할 가드 예시
function assertWithinCwd(filePath: string, cwd: string): void {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(cwd) + sep) && resolved !== resolve(cwd)) {
    throw new Error(`Access denied: path is outside the working directory`);
  }
}
```

## 수용 기준

- [ ] Read/Write/Edit 도구가 cwd 밖 경로 접근 시 명확한 에러를 반환한다
- [ ] `bypassPermissions` 모드에서도 경로 검증이 적용된다
- [ ] 기존 절대 경로 테스트가 통과한다 (cwd 내부 경로는 허용)

## 관련 파일

- `packages/agent-tools/src/builtins/read-tool.ts`
- `packages/agent-tools/src/builtins/write-tool.ts`
- `packages/agent-tools/src/builtins/edit-tool.ts`
- `packages/agent-tools/src/sandbox/workspace-manifest.ts` (참조 구현)

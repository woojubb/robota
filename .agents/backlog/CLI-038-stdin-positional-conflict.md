---
title: 'CLI-038: print 모드에서 stdin pipe + positional 동시 지원'
status: todo
created: 2026-05-24
priority: high
category: bug
---

## 문제

`print-mode.ts` L12-27:

```typescript
let prompt = opts.positional.join(' ').trim();
if (!prompt && !process.stdin.isTTY) {
  // stdin 읽기
}
```

positional이 있으면 stdin을 읽지 않는다.
따라서 `cat file.ts | robota -p "Review this code"` 패턴이 동작하지 않는다.
stdin 내용이 무시되고 `-p` 프롬프트만 처리된다.

`README.md` L143에서 이 패턴을 예시로 제시하고 있어 문서와 구현 불일치.

## 해결 방법

positional과 stdin을 함께 처리: stdin 내용을 프롬프트에 컨텍스트로 추가.

```typescript
let prompt = opts.positional.join(' ').trim();
if (!process.stdin.isTTY) {
  const stdinContent = await readStdin();
  if (stdinContent) {
    prompt = prompt ? `${prompt}\n\n<stdin>\n${stdinContent}\n</stdin>` : stdinContent;
  }
}
```

## 수용 기준

- [ ] `cat file.ts | robota -p "Review this code"` 가 동작한다
- [ ] stdin만 있을 때 (prompt 없음)도 동작한다
- [ ] E2E 테스트에 파이프 시나리오 추가

## 관련 파일

- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/__tests__/headless-e2e.test.ts`
- `packages/agent-cli/README.md`

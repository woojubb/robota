---
title: 'CLI-046: --denied-tools 플래그 추가'
status: done
completed: 2026-05-25
created: 2026-05-24
priority: low
category: feature
---

## Outcome

Shipped in PR #589 (ba6c6036b, 2026-05-25) and still in place: `--denied-tools` is parsed in
`packages/agent-cli/src/utils/cli-args.ts` (L45/L97/L195/L265), threaded to both TUI
(`renderApp({ deniedTools })` in `cli.ts`) and print mode, with tests in
`cli-args.test.ts`. Verified 2026-07-25 (PROC-001).

## 문제

`--allowed-tools`로 허용 도구 목록을 화이트리스트 지정할 수 있지만,
특정 도구만 제외하는 블랙리스트 방식(`--denied-tools`)이 없다.

순수 대화 모드(도구 없이): `--allowed-tools ""` 가 가능한지 불명확.
Bash 실행 없이 읽기만 허용하는 조합을 간단하게 표현할 수 없다.

## 해결 방법

`cli-args.ts`에 `--denied-tools` 플래그 추가:

```bash
robota --denied-tools "Bash,Write,Edit"   # 읽기 전용 모드
robota --denied-tools "*"                 # 도구 없는 순수 대화
```

permission-enforcer의 deny list에 연결.

## 수용 기준

- [ ] `--denied-tools Bash` 시 Bash 실행이 차단됨
- [ ] `--denied-tools "*"` 시 모든 도구 차단
- [ ] `--allowed-tools`와 `--denied-tools` 동시 사용 시 denied가 우선

## 관련 파일

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/args-to-options.ts`

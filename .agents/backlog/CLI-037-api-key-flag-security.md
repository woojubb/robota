---
title: 'CLI-037: --api-key 플래그 셸 히스토리 노출 경고'
status: done
created: 2026-05-24
priority: medium
category: security
---

## 문제

`robota --api-key sk-ant-xxxxx` 형태로 사용하면 API 키가 `~/.zsh_history`에 평문으로 기록된다.
`cli-args.ts` L154에 `'api-key': { type: 'string' }`가 정의되어 있지만 사용자에게 경고가 없다.

## 해결 방법

`--api-key` 플래그 사용 시 stderr에 경고 출력:

```
⚠  Warning: --api-key value will be stored in your shell history.
   Consider using --api-key-env instead: robota --api-key-env ANTHROPIC_API_KEY
```

또는 `--api-key-env`를 기본 방식으로 안내하고 README 설치 섹션에 명시.

## 수용 기준

- [ ] `--api-key` 플래그 사용 시 경고 출력된다
- [ ] `--api-key-env` 대안 안내가 포함된다
- [ ] README 환경변수 섹션에 보안 권고사항 추가

## 관련 파일

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/args-to-options.ts`

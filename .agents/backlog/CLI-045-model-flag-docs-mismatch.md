---
title: 'CLI-045: README의 --model 플래그 문서와 구현 불일치 해소'
status: todo
created: 2026-05-24
priority: high
category: bug
---

## 문제

`packages/agent-cli/README.md` L98:

```bash
robota --model claude-opus-4-7    # Use a specific model
```

그러나 `packages/agent-cli/src/utils/cli-args.ts`의 `PARSE_ARGS_CONFIG`에 `model` 옵션이 없다.
`IParsedCliArgs` 인터페이스에도 없다.

사용자가 `--model` 플래그를 사용하면 무시되거나 오류가 발생한다.

## 해결 방법

둘 중 하나 선택:

**A) 구현 (권고):** `--model <id>` 플래그를 추가해 지정된 모델로 프로바이더 오버라이드

- `IParsedCliArgs`에 `model?: string` 추가
- `toSessionRunOptions`에서 model을 provider 설정에 반영
- 현재 provider 설정의 model을 override

**B) 문서 수정:** README에서 `--model` 예시 제거, 모델 변경 방법을 `/provider switch` 또는 설정 파일로 안내

## 수용 기준

- [ ] 옵션 A: `robota --model claude-haiku-4-5 -p "hello"`가 동작
- [ ] 옵션 B: README에서 --model 예시 제거
- [ ] 어느 쪽이든 README와 구현이 일치

## 관련 파일

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/args-to-options.ts`
- `packages/agent-cli/README.md`

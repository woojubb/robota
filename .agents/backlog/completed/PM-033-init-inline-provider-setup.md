---
title: 'PM-033: robota init 완료 후 프로바이더 설정 인라인 연결'
status: todo
created: 2026-05-24
priority: medium
category: ux
---

## 문제

현재 `robota init` 완료 메시지:

```
Next steps:
  1. Edit AGENTS.md to describe your project conventions
  2. Run `robota --configure` to set up your AI provider
  3. Run `robota` to start the assistant
```

Step 2에서 `robota --configure`를 별도로 실행해야 한다.
많은 사용자가 Step 3로 바로 가서 "No provider configuration found" 오류를 만난다.

## 해결 방법

`robota init` 완료 시 프로바이더 설정 인라인 제안:

```
Initialization complete.

Would you like to set up a provider now? [Y/n]
```

Y 선택 시 `runProviderStartupSetup` 흐름 즉시 진행.
N 선택 시 기존 Next steps 안내.

비인터랙티브 환경에서는 프롬프트 없이 Next steps만 출력.

## 수용 기준

- [ ] `robota init` 완료 후 프로바이더 설정 제안 프롬프트가 뜬다
- [ ] Y 선택 시 API 키 입력까지 완료되면 즉시 `robota` 실행 가능
- [ ] `--no-configure` 플래그 또는 `--yes` 플래그로 자동화 가능
- [ ] `robota init --configure` 처럼 non-interactive 모드 지원

## 관련 파일

- `packages/agent-cli/src/init/init-command.ts`
- `packages/agent-cli/src/startup/provider-startup.ts`

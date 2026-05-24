---
title: 'PM-032: 환경변수(ANTHROPIC_API_KEY 등) 있을 때 설정 화면 건너뛰기'
status: done
created: 2026-05-24
priority: high
category: ux
---

## 문제

`ANTHROPIC_API_KEY` 환경변수가 설정되어 있어도 `~/.robota/settings.json`이 없으면
인터랙티브 설정 화면이 뜬다. Claude Code는 ENV 변수만으로 즉시 실행된다.

CI/Docker 환경에서 특히 문제:

```bash
# Docker에서 매번 설정 화면이 뜨거나 크래시
docker run -e ANTHROPIC_API_KEY=sk-ant-xxx robota -p "hello"
```

## 해결 방법

`config-phase.ts` 또는 `provider-setup.ts`에서 환경변수 감지 시 설정 건너뛰기:

```typescript
// 환경변수로 API 키가 있는 경우 settings.json 없어도 즉시 진행
if (process.env.ANTHROPIC_API_KEY && !settingsExist) {
  return createEphemeralAnthropicProvider(process.env.ANTHROPIC_API_KEY);
}
```

프로바이더 우선순위:

1. `--provider` 플래그
2. `settings.json`의 `currentProvider`
3. 환경변수 자동 감지 (ANTHROPIC → OpenAI → Gemini → DeepSeek 순)

## 수용 기준

- [ ] `ANTHROPIC_API_KEY`만 있어도 `robota -p "hello"` 즉시 실행
- [ ] CI 환경에서 non-interactive 실행 가능
- [ ] 설정 파일이 없을 때 어떤 프로바이더를 사용하는지 명확히 출력

## 관련 파일

- `packages/agent-cli/src/startup/config-phase.ts`
- `packages/agent-cli/src/startup/provider-setup.ts`
- `packages/agent-cli/src/startup/provider-startup.ts`

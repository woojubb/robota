---
title: 'CLI-027: --system-prompt / --append-system-prompt 플래그 실제 구현'
status: todo
created: 2026-05-24
priority: high
urgency: now
area: packages/agent-cli
depends_on: []
---

## Background

`--system-prompt <text>` 와 `--append-system-prompt <text>` 플래그가 README와 SPEC에 문서화되어 있으나, SPEC에 "parsed but not yet connected"로 명시된 채 미구현 상태다. 플래그는 CLI 인자 파서에서 읽히지만 실제 `InteractiveSession` 또는 print 모드에 전달되지 않는다.

문서에 있는 기능이 동작하지 않으면 사용자 신뢰를 직접 훼손한다. 특히 이 플래그는:

- CI 파이프라인에서 커스텀 리뷰 가이드라인 주입 시 필수
- `robota -p "..." --system-prompt "You are a security reviewer..."` 패턴의 핵심
- CLI 자동화 가치의 상당 부분을 차지함

## 작업 항목

1. `src/utils/cli-args.ts`에서 파싱된 `systemPrompt` / `appendSystemPrompt` 값을 `InteractiveSession` 생성 시 전달
2. print 모드(`-p`)에서도 동작하도록 `print-mode.ts` 업데이트
3. 단위 테스트: `--system-prompt` 값이 세션 시스템 프롬프트에 실제 반영되는지 확인
4. README의 "parsed but not yet connected" 주석 제거 및 사용 예제 추가

## 성공 기준

```bash
robota -p "List files" --system-prompt "Always respond in JSON format"
# → JSON 형식으로 응답이 나와야 함
```

## 검증 시나리오 (User Execution)

1. `robota -p "What is 2+2" --system-prompt "Always answer in Korean"` → 한국어 답변 확인
2. `robota -p "Summarize this" --append-system-prompt "End every response with a disclaimer"` → 면책 조항 추가 확인
3. headless 모드와 interactive 모드 양쪽에서 동작 확인

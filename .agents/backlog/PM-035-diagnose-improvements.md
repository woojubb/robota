---
title: 'PM-035: diagnose 커맨드 3가지 개선'
status: todo
created: 2026-05-24
priority: medium
category: ux
---

## 문제

PM-024에서 구현된 `robota diagnose`에 3가지 약점이 발견됐다:

### 1. DASHSCOPE_API_KEY(Qwen) 체크 누락

`checkApiKey()`가 ANTHROPIC, OPENAI, GEMINI, DEEPSEEK만 체크한다.
Qwen 프로바이더의 `DASHSCOPE_API_KEY`가 빠져있다.

### 2. 네트워크 체크가 항상 api.anthropic.com만 체크

현재 설정된 프로바이더가 OpenAI나 DeepSeek여도 `api.anthropic.com:443`을 체크한다.
OpenAI 사용자에게는 의미없는 체크 결과를 보여준다.

### 3. settings.json 내용 검증 없음

파일 존재 여부만 확인. 손상된 JSON이나 스키마 불일치를 감지 못함.
`diagnose`에서 이상 없다고 나왔는데 실행하면 크래시하는 상황 발생 가능.

### 4. "robota configure" vs "robota --configure" 불일치

diagnose 출력에서 `robota configure`라고 안내하는데 실제 플래그는 `robota --configure`다.

## 해결 방법

1. `checkApiKey()`에 `DASHSCOPE_API_KEY` 추가
2. `checkNetwork()`가 현재 설정된 프로바이더 엔드포인트를 체크하도록 변경
3. `checkSettingsFile()`에 JSON 파싱 검증 추가
4. 모든 안내 메시지에서 `robota --configure` 통일

## 수용 기준

- [ ] `DASHSCOPE_API_KEY` 체크 포함됨
- [ ] 네트워크 체크가 현재 프로바이더 엔드포인트를 사용
- [ ] settings.json이 유효한 JSON인지 검증
- [ ] 안내 메시지 플래그 형식 일관성

## 관련 파일

- `packages/agent-cli/src/startup/diagnose-command.ts`

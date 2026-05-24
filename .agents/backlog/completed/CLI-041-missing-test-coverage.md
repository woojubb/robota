---
title: 'CLI-041: diagnose, init, web-fetch, web-search 테스트 커버리지'
status: todo
created: 2026-05-24
priority: medium
category: test
---

## 문제

핵심 기능임에도 테스트가 전혀 없는 파일들:

| 파일                  | 중요도 | 미검증 경로                                                                   |
| --------------------- | ------ | ----------------------------------------------------------------------------- |
| `diagnose-command.ts` | 높음   | checkNodeVersion, checkApiKey, checkSettingsFile, checkTerminal, checkNetwork |
| `init-command.ts`     | 높음   | Claude Code 마이그레이션 경로, AGENTS.md 생성                                 |
| `web-fetch-tool.ts`   | 중간   | 네트워크 에러, 타임아웃, 대용량 응답                                          |
| `web-search-tool.ts`  | 중간   | 에러 처리 (classifyFetchError 패턴 없음)                                      |

## 해결 방법

각 파일별 테스트 추가:

- `diagnose-command.ts`: 각 check 함수 단위 테스트 (Node 버전, API 키, 터미널 감지)
- `init-command.ts`: 파일 생성, Claude Code 마이그레이션, JSON 파싱 실패 케이스
- `web-fetch-tool.ts`: `classifyFetchError` 단위 테스트
- `web-search-tool.ts`: API 키 없는 경우, 네트워크 에러 처리

## 수용 기준

- [ ] `diagnose-command.ts` 5개 이상 테스트
- [ ] `init-command.ts` Claude 마이그레이션 경로 테스트
- [ ] `web-fetch-tool.ts` 에러 분류 테스트
- [ ] 전체 agent-cli 테스트 커버리지 28% → 50% 이상

## 관련 파일

- `packages/agent-cli/src/startup/diagnose-command.ts`
- `packages/agent-cli/src/init/init-command.ts`
- `packages/agent-tools/src/builtins/web-fetch-tool.ts`
- `packages/agent-tools/src/builtins/web-search-tool.ts`

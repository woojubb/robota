---
title: 'CLI-031: 도구 출력 30,000자 truncation — 사용자 알림 및 UX 개선'
status: done
created: 2026-05-24
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-transport-tui
depends_on: []
---

## Background

현재 Bash, Read 등 도구의 출력이 30,000자를 초과하면 잘려서 모델에게 전달된다. 잘림이 발생해도 사용자에게 명확한 알림이 없어서, 모델이 불완전한 출력을 기반으로 틀린 결론을 내릴 수 있다.

예: `pnpm test` 출력이 매우 길 때, 모델이 중간에 잘린 test 결과를 "모든 테스트 통과"로 해석할 수 있다.

## 작업 항목

1. 도구 출력이 truncation threshold에 도달할 때 모델에게 전달되는 메시지에 명시적 truncation 표시 추가:
   ```
   [출력이 30,000자에서 잘렸습니다. 전체 출력을 보려면 파일로 저장하거나 --output-format을 사용하세요]
   ```
2. TUI에서 truncated 도구 결과를 시각적으로 구분 (예: 주황색 테두리, "truncated" 배지)
3. truncation 발생 시 사용자에게 대안 제시:
   - 출력을 파일로 저장하도록 명령 수정 제안
   - 더 짧은 청크로 나눠 처리하도록 안내

## 성공 기준

- 도구 출력이 잘렸을 때 모델이 "출력이 잘렸음"을 인식하고 이를 고려한 응답 생성
- TUI에서 truncated 결과가 시각적으로 구분됨
- 사용자가 잘림 사실을 인지하고 대안을 선택할 수 있음

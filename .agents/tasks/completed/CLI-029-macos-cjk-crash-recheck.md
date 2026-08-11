---
title: 'CLI-029: macOS Terminal.app CJK 입력 크래시 — 근본 해결 여부 재검증'
status: done
created: 2026-05-24
priority: high
urgency: now
area: packages/agent-transport-tui
depends_on: []
---

## Background

CLI-016이 "done" 처리됐지만 fix 내용이 "blank line 추가" 수준의 workaround로, 근본 해결인지 불명확하다. macOS Terminal.app에서 한국어/일본어/중국어(CJK) IME 입력 시 SIGSEGV로 크래시하는 이슈는 Ink + 특정 macOS 버전 조합에서 발생하는 known upstream 문제다.

이 프로젝트 자체가 한국 팀이 만들었는데 기본 터미널(Terminal.app)에서 한국어 입력이 죽으면 신뢰가 치명적으로 손상된다. 한국 개발자 전체와 일본, 중국 개발자를 포함한 CJK 사용자 모두가 영향받는다.

## 검증 항목

1. 최신 코드(beta.67)로 macOS Sequoia + Terminal.app 환경에서 CJK 입력 재현 시도
2. 재현된다면:
   - Ink upstream 이슈 트래커 상태 확인
   - `@robota-sdk/agent-transport-tui` 레벨에서 임시 완화 가능한지 검토
   - 첫 실행 시 "Terminal.app에서 CJK 입력 시 불안정할 수 있습니다. iTerm2 권고" 경고 배너를 더 눈에 띄게 표시
3. 재현 안 된다면: CLI-016 fix가 실제로 해결됐음을 명시적으로 기록 + 테스트 추가

## 결과물

- 재현 여부 + macOS/Node 버전 조합 매트릭스 문서화
- 해결됐으면 → 테스트 추가 후 close
- 미해결이면 → 첫 실행 경고 개선 + upstream 이슈 링크 → 별도 fix 티켓 분리

## 성공 기준

CJK 사용자가 Terminal.app에서 robota를 실행했을 때:

- 크래시 발생 시: 즉시 친절한 오류 메시지 + 대안 안내 (크래시 없이 종료)
- 이상적: 크래시 자체가 없음

---
title: 'CLI-016: macOS Terminal.app CJK IME 입력 크래시 해결'
status: done
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli
depends_on: []
---

## Background

macOS 기본 Terminal.app에서 한국어/일본어/중국어(CJK) IME 입력 시 CLI가 crash한다. 현재 문서에는 "iTerm2 사용 권장"이라고 안내되어 있으나, 이는 회피책일 뿐 해결책이 아니다.

한국/일본 개발자 시장을 타겟팅하는 제품에서 한국어 입력이 기본 터미널에서 crash를 유발하는 것은 치명적인 이탈 요인이다. 특히 이 프로젝트 자체가 한국 팀에 의해 개발되고 있다.

## 작업 항목

- TUI 입력 처리 라이브러리(readline/inquirer/prompts 등)에서 CJK IME composition 이벤트 처리 방식 조사
  - `compositionstart`, `compositionend`, `compositionupdate` 이벤트 처리 부재 여부 확인
  - Node.js readline의 CJK 처리 버그 여부 확인
- macOS Terminal.app + 한국어 키보드 레이아웃에서 재현 환경 구성
- crash 원인 식별 (SIGABRT, uncaught exception, readline 버그 등)
- 수정 또는 upstream 버그 리포트 제출
- 단기 완화: `--no-tui` 또는 print 모드에서는 IME 영향 없음 안내 추가
- `iTerm2 권장` 안내를 버그 해결 전까지 더 눈에 띄게 표시

## Test Plan

- macOS Terminal.app에서 한국어 IME 활성화 후 CLI 실행
- 한글 입력(조합 중) 시 crash 없이 정상 입력 확인
- iTerm2, Warp 등 주요 터미널에서 동일 입력 테스트

## User Execution Test Scenarios

### Scenario 1: macOS Terminal.app 한국어 입력

macOS Terminal.app을 열고:

```bash
npx @robota-sdk/agent-cli
```

한국어 키보드로 한글 텍스트 입력 시도.

Expected: crash 없이 정상 입력 및 전송 가능

---
title: CLI 붙여넣기 시 텍스트가 분할되는 버그
status: completed
priority: high
created: 2026-03-24
packages:
  - agent-cli
---

## 요약

긴 텍스트를 CLI에 붙여넣으면 하나의 paste로 인식되지 않고 여러 개(3등분 등)로 분할되어 입력됨.

## 재현 조건

- 긴 마크다운 텍스트(요약 보고서 등)를 복사 후 CLI input에 붙여넣기
- 터미널: macOS Terminal.app 또는 iTerm2
- 결과: [Pasted text #1], [Pasted text #2], [Pasted text #3] 등 여러 라벨로 분리됨

## 원인 분석 (확인됨)

터미널이 큰 텍스트를 stdin buffer 크기 단위로 여러 chunk에 나눠 전달함.
각 chunk가 개별 `useInput` 호출로 들어오고, `CjkTextInput.tsx:100`에서 `\n`/`\r` 포함 여부로 paste를 감지.
chunk마다 별도 `onPaste` 호출 → `InputArea.tsx:114`에서 각각 새 paste ID 생성 → 여러 라벨로 분리됨.

**핵심 코드 경로:**

1. `CjkTextInput.tsx:100` — `input.length > 1 && input.includes('\n')` → `onPaste(chunk)`
2. `InputArea.tsx:114` — `handlePaste` → 새 ID 발급 → `[Pasted text #N]` 라벨 생성

## 해결 방향

1. **Debounce (간단)**: 짧은 시간(50-100ms) 내 연속 paste를 하나로 합침.
   InputArea의 `handlePaste`에서 이전 paste가 50ms 이내면 기존 paste에 append.
2. **Bracketed paste mode (근본적)**: 터미널의 `\x1b[200~` ... `\x1b[201~` 시퀀스를 감지해서
   paste 시작/끝을 정확히 구분. stdin에 직접 접근 필요 (Ink의 useInput 우회 가능성).
3. **혼합**: debounce를 기본으로, bracketed paste가 지원되면 우선 사용.

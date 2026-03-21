# Terminal.app Korean IME Crash — Root Cause Analysis

## 크래시 원인

**Terminal.app 자체의 SIGSEGV** (우리 프로세스가 아님)

### 발생 경로

1. CjkTextInput에서 `setCursorPosition({ x: cursorX, y: 0 })` 호출
2. Ink의 `log-update`가 `y: 0`을 "전체 출력의 맨 위"로 해석
3. 터미널 커서가 로고/메시지 영역(25줄 위)으로 이동
4. 한국어 IME가 커서 위치에서 `attributedSubstringFromRange:` 호출
5. 해당 위치에 편집 가능한 텍스트가 없음 → nil/잘못된 범위
6. Terminal.app이 null 역참조 → **SIGSEGV**

### 왜 try-catch로 막을 수 없는가

크래시가 우리 Node.js/Bun 프로세스가 아니라 **Terminal.app 네이티브 코드**에서 발생.
`uncaughtException`, `SIGSEGV` signal handler 모두 무의미 — Terminal.app 프로세스가 죽는 것.

## Claude Code가 크래시하지 않는 이유

1. **커스텀 렌더러** — Ink의 `log-update` 대신 자체 터미널 렌더러 사용. 셀 단위 diff + 최소 ANSI escape
2. **커서 위치를 직접 관리** — Ink의 `useCursor`/`setCursorPosition` 미사용
3. **DSR 6 쿼리** — Device Status Report로 실제 커서 위치 확인
4. 결과: IME 후보창이 좌하단에 뜸 (#19207), 하지만 **크래시 안 됨**

## 적용한 수정

`setCursorPosition()` 호출 완전 제거.
- IME 후보창이 좌하단에 표시 (Claude Code와 동일 동작)
- Terminal.app 크래시 방지

## 향후 개선 (Optional)

올바른 y 좌표를 전달하려면 Ink의 전체 렌더링 높이를 알아야 하나,
Ink는 이 값을 컴포넌트에 노출하지 않음. 커스텀 렌더러 없이는 불가능.

## 참고

- Claude Code Issue #19207: IME cursor position for CJK
- Claude Code Issue #22732: Korean IME invisible composition
- Claude Code Issue #3045: Patching React Ink for IME
- Terminal.app SIGSEGV: `attributedSubstringFromRange:` null dereference

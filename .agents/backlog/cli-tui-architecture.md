# CLI TUI 아키텍처 전환

## 목표

Claude Code 수준의 터미널 UI 구현. readline 기반 REPL에서 벗어나 분리된 렌더링 영역을 가진 TUI로 전환.

## 현재 문제

- readline이 stdin을 독점 → permission prompt, spinner 등과 충돌
- 출력과 입력이 같은 스트림에서 섞임 → 화면 깨짐
- 방향키 선택 UI 구현 불가 (readline history와 충돌)
- 응답 스트리밍 중 사용자 입력 불가

## 목표 레이아웃

```
┌─────────────────────────────────┐
│  대화 영역 (스크롤)              │
│  - AI 응답 (markdown 렌더링)     │
│  - Tool 실행 결과                │
│  - Permission 선택 결과          │
│                                 │
│                                 │
├─────────────────────────────────┤
│  상태바 (모드, 토큰, 세션 등)     │
├─────────────────────────────────┤
│  입력 영역 (고정)                │
│  > _                            │
└─────────────────────────────────┘
```

## 핵심 요구사항

- **상단**: 스크롤 가능한 대화 영역, markdown 렌더링
- **하단**: 고정된 입력 영역, 입력 중에도 상단 업데이트 가능
- **Permission prompt**: 입력 영역에서 방향키 선택 UI
- **Spinner/Progress**: 상태바 또는 대화 영역에 표시, 입력 영역과 간섭 없음
- **Streaming**: AI 응답이 실시간으로 대화 영역에 추가

## 기술 후보

### Ink (React for CLI)

- React 컴포넌트 모델로 TUI 구성
- 선언적 UI, 상태 관리 용이
- 활발한 생태계 (`ink-text-input`, `ink-select-input`, `ink-spinner`)
- 단점: React 런타임 의존성, 학습 비용

### Blessed / Blessed-contrib

- 전통적인 ncurses 스타일 TUI
- 윈도우, 스크롤, 키 바인딩 직접 제어
- 단점: 오래된 라이브러리, 유지보수 불활발

### 직접 구현 (ANSI escape)

- Alternate screen buffer (`\x1b[?1049h`)
- 커서 위치 직접 제어 (`\x1b[row;colH`)
- 스크롤 영역 설정 (`\x1b[top;bottomr`)
- 단점: 구현량 많음, 터미널 호환성 이슈

### @clack/prompts

- 가벼운 interactive prompt 라이브러리
- 방향키 선택, 텍스트 입력, spinner 등 제공
- 단점: 전체 TUI 프레임워크는 아님, 부분적 해결

## 권장 접근

1단계: `@clack/prompts`로 permission prompt만 먼저 해결 (백로그 `cli-permission-prompt-ux.md`와 연계)
2단계: Ink로 전체 REPL UI 재구성

## 참고

- Claude Code TUI: 상단 스크롤 + 하단 고정 입력 + 중간 상태바
- 기존 백로그: `.agents/backlog/cli-permission-prompt-ux.md` (permission prompt 구체 이슈)

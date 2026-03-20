# CLI Ink TUI 전환

## Status: completed

## Goal

readline 기반 REPL을 React + Ink 기반 TUI로 전환. 상단 스크롤 대화 영역 + 하단 고정 입력 + 상태바.

## Scope

- `src/repl/` 디렉토리를 `src/ui/` (Ink 컴포넌트)로 교체
- Session, tools, permissions 로직은 변경 없음
- permission prompt를 ink-select-input으로 구현 (방향키 선택)

## Tasks

### Task 1: Dependencies & Build Config

- [ ] Install: ink, react, @types/react, ink-text-input, ink-select-input, ink-spinner
- [ ] tsconfig.json에 jsx: "react-jsx" 추가
- [ ] tsup에서 .tsx 지원 확인

### Task 2: Core UI Components

- [ ] src/ui/App.tsx — 메인 레이아웃 (Box flexDirection column)
- [ ] src/ui/MessageList.tsx — 대화 메시지 목록 (스크롤)
- [ ] src/ui/InputArea.tsx — 하단 고정 입력 (ink-text-input)
- [ ] src/ui/StatusBar.tsx — 모드, 세션 정보
- [ ] src/ui/PermissionPrompt.tsx — Allow/Deny 방향키 선택
- [ ] src/ui/Spinner.tsx — Thinking 표시

### Task 3: Session Integration

- [ ] src/ui/hooks/useSession.ts — Session.run() 호출, 상태 관리
- [ ] src/ui/hooks/usePermission.ts — permission check를 React state로 관리
- [ ] ITerminalOutput을 Ink 기반으로 교체 또는 제거

### Task 4: CLI Entry Point 연결

- [ ] cli.ts에서 Ink render() 호출로 변경
- [ ] bin.ts는 그대로 유지
- [ ] Slash commands를 useInput 기반으로 변환

### Task 5: 기존 REPL 코드 정리

- [ ] src/repl/ 디렉토리 제거 (또는 deprecated)
- [ ] 테스트 업데이트

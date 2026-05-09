---
title: 'CLI2-002: --language 플래그가 인터랙티브 TUI 모드에서 무시됨'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: cli
source: qa-prelaunch-report-2026-05-10-v2
---

## Problem

`robota --language ko`로 시작해도 TUI 세션 언어가 변경되지 않는다.

- `packages/agent-cli/src/ui/render.tsx:26` — `IRenderOptions`에 `language?: string` 선언됨
- `packages/agent-cli/src/ui/App.tsx` — `IProps` 인터페이스에 `language` 필드 없음
- `packages/agent-cli/src/cli.ts:395` — `language: args.language`가 `renderApp()`에 전달됨

`renderApp(options)` 호출 시 `<App {...options} />`로 스프레드되지만 `App.tsx`의 `IProps`에 `language`가 없어 컴포넌트가 수신하지 않는다. `InteractiveSession`은 `language` 옵션 자체를 받지 않고 설정 파일(`settings.json`)에서만 읽는다.

DEV-M-004와 동일한 이슈.

## Required Change

1. `App.tsx`의 `IProps`에 `language?: string` 추가
2. `InteractiveSession` 생성 시 `language` 옵션 전달 (SDK가 지원하는 경우) 또는 설정 파일 임시 override 방식 적용
3. 단기 대안: CLI `--help` 또는 `--language` 설명에 "현재 설정 파일을 통해서만 적용됨" 명시

```typescript
// App.tsx IProps에 추가
interface IProps extends IRenderOptions {
  language?: string;
  // ...
}

// InteractiveSession 생성 시 language 전달
const session = new InteractiveSession({
  // ...
  language: props.language,
});
```

## Scope

- `packages/agent-cli/src/ui/App.tsx` — `IProps`에 `language` 추가, 세션 생성 시 전달
- `packages/agent-cli/src/ui/render.tsx` — `IRenderOptions` 확인
- `packages/agent-sdk/src/interactive/interactive-session.ts` — `IInteractiveSessionStandardOptions`에 `language` 지원 여부 확인 및 추가

## Test Plan

1. `robota --language ko`로 세션 시작 후 AI 응답 언어 확인 (설정 파일에 language 없는 환경)
2. `IProps`, `IRenderOptions`, `IInteractiveSessionStandardOptions` 타입 정합성 typecheck 통과 확인
3. `language` 미지정 시 기존 동작(설정 파일 기반) 회귀 없음 확인

## User Execution Test Scenarios

### 시나리오 1: --language 플래그로 세션 언어 변경 확인

**전제조건**: `robota` 바이너리 설치, `settings.json`에 `language` 항목이 없거나 `en`으로 설정된 환경

**실행 단계**:

```bash
robota --language ko
```

TUI가 열리면 "안녕하세요" 또는 임의 메시지를 입력 후 AI 응답 언어 확인

**기대 결과**: AI가 한국어로 응답한다. `settings.json`의 language 설정보다 CLI 플래그가 우선 적용된다.

**증거 필드** (구현 후 기입):

- 관찰 결과: \_

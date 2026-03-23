---
title: CLI-BL-005 장시간 세션 메모리 최적화
status: backlog
priority: medium
created: 2026-03-23
packages:
  - agent-cli
---

## 문제

CLI를 장시간 (10시간+) 실행하면 Terminal.app이 크래시 (memory corruption of free block). iTerm2에서는 발생하지 않지만 메모리 누적이 근본 원인일 수 있음.

## 근본 원인

React state에 메시지/tool 상태가 무한 누적 + Ink가 매번 전체 트리 re-render. **Claude Code도 동일한 미해결 문제** (GitHub #25926, #18011, #4953, #30131, #33439).

## 리서치 결과 (2026-03-23)

### 메모리 증가 경로

1. `messages` 배열: 대화 히스토리가 React state에 무한 누적
2. `activeTools` 배열: tool 실행 상태 + payload 누적
3. Ink full-tree re-render: 매 state 변경마다 전체 컴포넌트 트리 재조정
4. ANSI escape 출력: 큰 컴포넌트 트리 → 대량 escape sequence → Terminal.app 버퍼 corruption

### Claude Code 관련 이슈

- #25926: `mutableMessages` UI 배열 무한 증가 → V8 heap OOM (4.1GB)
- #18011: 장시간 세션에서 V8 OOM (SIGABRT)
- #4953: 프로세스가 120+GB까지 증가
- #30131: v2.1.63에서 빈번한 SIGABRT
- #33439: TUI heap 100s MB/sec 속도로 누적

### Terminal.app vs iTerm2

Terminal.app은 memory-unsafe 코드로 작성되어 고출력 ANSI 환경에서 heap corruption 취약. iTerm2는 동일 조건에서 안정적. ANSI 문자열 multiplier 공격으로 DoS 가능한 것과 같은 맥락.

## 해결 우선순위

| 순위 | 해결책                                                               | 효과                              | 난이도 |
| ---- | -------------------------------------------------------------------- | --------------------------------- | ------ |
| 1    | 메시지 윈도잉 — 최근 N개만 렌더, 나머지는 session history에 보존     | 핵심 메모리 증가 방지             | 중     |
| 2    | `<Static>`으로 확정된 메시지 처리 — 한 번 렌더 후 re-render 제외     | re-render 비용 절감               | 낮음   |
| 3    | tool 상태 정리 — 완료된 tool의 payload 제거, 상태만 유지             | payload 누적 방지                 | 낮음   |
| 4    | 메모리 임계값 감시 — `process.memoryUsage()` 주기적 체크 → 강제 정리 | 안전망                            | 중     |
| 5    | `React.memo` + `useMemo` 전면 적용                                   | CPU 절감, 간접적 메모리 도움      | 낮음   |
| 6    | Alternate screen buffer 사용                                         | Terminal.app 스크롤백 크래시 방지 | 낮음   |

## 구현 방향 (메시지 윈도잉)

```
- 전체 메시지 히스토리: session store (디스크)에 보존
- React state: 최근 50-100개 메시지만 유지
- 새 메시지 추가 시 오래된 메시지를 state에서 제거
- Ink <Static>으로 viewport 밖 메시지를 한 번만 렌더
- 스크롤백 필요 시 session history에서 로드
```

## 참고 자료

- Ink GitHub: subtree rendering 미지원 (#21), 스크롤 미지원 (#222)
- ink-scroll-view: 커뮤니티 스크롤 컴포넌트
- V8 GC: 장수 객체 Old Space 승격 → 비용 큰 mark-compact
- Node.js `--max-old-space-size=8192`: 임시 방편, 근본 해결 아님

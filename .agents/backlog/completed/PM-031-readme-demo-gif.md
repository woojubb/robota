---
title: 'PM-031: README 데모 GIF/스크린샷 추가'
status: done
created: 2026-05-24
completed: 2026-07-26
priority: high
category: marketing
---

## Progress (2026-07-26) — DONE, real GIF landed

`packages/agent-cli/docs/demo.gif` is now a **real recording of the real binary**, replacing the
41-byte 1×1 placeholder that had been shipping a broken image on GitHub/npm since PR #589.

**녹화 내용 (about 5.8 s, loops):** `robota` boots in a throwaway task-board project under the OS
temp dir → the prompt `Explain the main entry point of this project` is typed keystroke by
keystroke → the agent answers with a `Read` tool call that **really executes** against
`src/index.ts` → the answer renders in the TUI (You / Tool / Robota panes, status bar) and is held
for 3 s.

**도구 — nothing external installed.** `asciinema`/`agg`/`terminalizer`/`ffmpeg` are not available
on the build machine and cannot be installed without root, so the recorder is built from packages
this repo can install itself: `@homebridge/node-pty-prebuilt-multiarch` (already a devDependency)
drives the built `bin/robota.cjs` in a real PTY, the capture is replayed into **xterm.js** inside
headless **Chromium** (`playwright`) and screenshotted per output change, and the frames are encoded
with **`gifenc`** (`pngjs` decodes the screenshots). New devDependencies: `playwright`,
`@xterm/xterm`, `gifenc`, `pngjs`.

**에셋:** 791 × 622 px, 17 frames, **75,787 bytes (74 KiB)** — 5 MB 예산의 1.5 %.

**결정론:** the model turns come from the offline `--session-log` replay provider (INFRA-017), so
the recording needs no API key and no network; only the model turns are replayed — CLI, TUI, tool
registry and the `Read` tool all run for real. Frames are sampled from the recorded timeline, not
wall-clock.

**유출 방지:** the recorder spawns the child with a minimal env (`PATH`, temp `HOME`, `TERM`) and
scans the captured output before writing anything — a home-directory path, `user@host`, the
machine's hostname or an API-key-shaped token **fails the run**. The frames were also reviewed
one by one; the only path on screen is the neutral `/tmp/robota-demo/task-board/src/index.ts`.

**재현:** `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli demo:record`
— the script (`packages/agent-cli/scripts/record-demo.mjs`) is committed alongside the asset and
documented in `packages/agent-cli/docs/DEMO-SCRIPT.md`.

**부수 수정:** the first-run welcome box was hand-drawn for a longer binary name, so every line
carrying the interpolated name was five columns short and the right border stair-stepped — visible
to every first-run user and in the recording. It is now sized from its own text (`string-width`),
with a test pinning every box line to one display width.

Related: `.agents/backlog/REL-014-record-cli-demo-gif.md` asks for the same asset and is satisfied
by this recording (its "> 10 KB animated recording" criterion included).

## 문제

README에 TUI가 어떻게 생겼는지 이미지가 전혀 없다.
Aider, Claude Code 등 경쟁 도구는 모두 데모 GIF를 README 상단에 보유한다.
텍스트만으로는 처음 보는 개발자가 "이 도구가 어떻게 생겼는지" 알 수 없다.

## 해결 방법

1. PTY로 실제 빌드된 바이너리를 구동해 터미널 출력을 녹화 (`scripts/record-demo.mjs`)
2. xterm.js + headless Chromium으로 프레임 렌더링, `gifenc`로 GIF 인코딩
3. README 설치 섹션 바로 위 Demo 섹션에 삽입

**녹화 시나리오 (2분 이내):**

```
robota
> Explain the main entry point of this project
[에이전트가 Read 툴로 파일을 읽고 설명하는 장면]
```

## 수용 기준

- [x] README 상단(설치 직후)에 데모 GIF 또는 스크린샷 삽입 — `packages/agent-cli/README.md` Demo 섹션
- [x] GIF 크기 5MB 이하 — 74 KiB (recorder는 5 MB 초과 시 실패)
- [x] TUI의 실제 코딩 어시스턴트 동작이 보임 — 실제 `Read` 툴 실행 + 답변 렌더링

## 예상 작업 시간

2시간 이내

/**
 * TERM-003 / TEST-007: real-binary terminal-handoff evidence.
 *
 * Runs in the dedicated PTY vitest project (vitest.pty.config.ts) against the BUILT robota binary
 * (`pnpm --filter @robota-sdk/agent-cli build` first). Unlike the source-level fixture E2E
 * (`terminal-handoff-pty-e2e` / `command-handoff-pty-e2e`), this drives the WHOLE user path —
 * real CLI → real command pipeline → real `TerminalHandoffController` injected by `render.tsx` →
 * `/shell` — through a real pseudo-terminal, simulating a user typing. It is automated
 * user-execution-level proof: the child runs on the real terminal during the handoff and the TUI
 * frame restores afterward (machine proxy for "no stale frame / clean resume").
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

describe('terminal handoff through the real binary (TERM-003)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-handoff-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(() => {
    session?.kill();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-09: /shell runs a one-shot command on the real terminal and the TUI restores', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });

    // Boot.
    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/Idle/);

    // Run a one-shot shell command. A user-typed command is not permission-gated (that gate is for
    // model/agent-invoked actions), so it runs directly through the handoff.
    await session.sendKeys('/shell echo HANDOFF_REAL_OK');
    await session.pressEnter();

    // The child's output appears on the real (inherited) terminal during the handoff.
    await session.waitFor(/HANDOFF_REAL_OK/, 20_000);

    // The TUI reclaims the screen: the prompt frame redraws (clean resume, no hang).
    await session.waitFor(/Type a message or \/help/, 20_000);
  }, 60_000);

  it('TC-04/TC-01: committed history (Static) is not re-printed after a /shell handoff (SCREEN-010 × TERM-002)', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });

    await session.waitFor(/Type a message or \/help/);
    await session.waitFor(/Idle/);

    // The startup banner is committed to the terminal scrollback via a single Ink <Static> (TC-01).
    // Count its version line; if the handoff resume re-emitted committed history, it would re-print.
    const versionRe = /v\d+\.\d+\.\d+/g;
    const beforeCount = (session.snapshot().match(versionRe) ?? []).length;
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    await session.sendKeys('/shell echo HANDOFF_OK');
    await session.pressEnter();
    await session.waitFor(/HANDOFF_OK/, 20_000);
    await session.waitFor(/Type a message or \/help/, 20_000);

    // SCREEN-010 keeps <Static> mounted at a stable tree position across suspend/resume, so the
    // committed banner is NOT re-printed on return (TC-04).
    const afterCount = (session.snapshot().match(versionRe) ?? []).length;
    expect(afterCount).toBe(beforeCount);
  }, 60_000);
});

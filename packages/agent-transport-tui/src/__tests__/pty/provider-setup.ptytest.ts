/**
 * Real-PTY provider-setup ask suite (CMD-004 TC-09 done-gate).
 *
 * Drives the BUILT robota binary through `/provider add` so the unified ask seam renders end-to-end on
 * a real terminal: the provider command self-asks (via the injected `askHandler` → `TuiInteractionChannel.askUser`)
 * and the TUI renders the request through `PendingActionPrompt`. Proves the masked secret field hides
 * the typed API key on the real CLI — the User Execution evidence the done-gate requires (no human
 * needed; the PTY drives the binary). Run via `pnpm --filter @robota-sdk/agent-transport-tui test:pty`
 * against a freshly built CLI.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const SECRET = 'topsecretapikey';

describe('provider setup ask through a real PTY (CMD-004 TC-09)', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-pty-provider-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(() => {
    session?.kill();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('TC-09: /provider add asks the masked API-key field and never echoes the secret', async () => {
    session = spawnTui({ projectDir, homeDir: join(projectDir, 'home') });
    await session.waitFor(/Type a message or \/help/);

    // The provider command self-asks; the first anthropic setup step is the masked API key.
    await session.sendKeys('/provider add anthropic');
    await session.pressEnter();
    await session.waitFor(/Anthropic API key/);

    // Type the secret at human key rate; the masked field must render `*`, not the plaintext.
    await session.sendKeys(SECRET);
    await session.waitFor(new RegExp(`\\*{${SECRET.length}}`));

    const masked = session.snapshot();
    expect(masked).not.toContain(SECRET);
    expect(masked).toContain('*'.repeat(SECRET.length));

    // Esc cancels the wizard (no settings write / restart effect); the secret stays off-screen.
    session.pressEscape();
    await session.waitFor(/Provider setup cancelled\./);
    expect(session.snapshot()).not.toContain(SECRET);
  }, 60_000);
});

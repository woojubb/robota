/**
 * CLI-083 (issue #2287) — the org policy survives the TUI projection.
 *
 * `toChannelOptions` builds the channel's options field by field. `orgPolicy` was not among them, so
 * a policy forwarded from the shell arrived here and was dropped, and `blockedCommands` enforcement
 * stayed dead on the plain `robota` path — the most common one — after two rounds of wiring it.
 *
 * The reason it was silent is worth keeping: the shell forwards with
 * `...(orgPolicy === null ? {} : { orgPolicy })`, and a SPREAD BYPASSES TypeScript's excess-property
 * check. Written as `orgPolicy,` it would not have compiled against an `IRenderOptions` that lacks
 * the field. The idiom chosen to be safe about optionality disabled the check that would have caught
 * the missing declaration.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadOrgPolicy } from '@robota-sdk/agent-framework';
import { describe, expect, it, vi } from 'vitest';

import { toChannelOptions } from '../render.js';
import { TuiInteractionChannel } from '../TuiInteractionChannel.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { IRenderOptions } from '../render.js';

const POLICY = { blockedCommands: ['clear'], adminContact: 'ops@x' };

function renderOptions(extra: Partial<IRenderOptions> = {}): IRenderOptions {
  return { cwd: '/work', provider: {} as never, ...extra } as IRenderOptions;
}

describe('CLI-083: the TUI projection carries the org policy', () => {
  it('copies a supplied policy into the channel options', () => {
    const channel = toChannelOptions(renderOptions({ orgPolicy: POLICY as never }));

    expect((channel as { orgPolicy?: unknown }).orgPolicy).toEqual(POLICY);
  });

  it('carries none when none was supplied, so absence stays distinguishable', () => {
    const channel = toChannelOptions(renderOptions());

    expect((channel as { orgPolicy?: unknown }).orgPolicy).toBeUndefined();
  });

  it('preserves the same policy through the channel into the session', () => {
    const channel = toChannelOptions(renderOptions({ orgPolicy: POLICY as never }));

    expect((buildTuiSessionOptions(channel) as { orgPolicy?: unknown }).orgPolicy).toBe(POLICY);
  });

  it('enforces a blocked command from a policy file in a real TUI-owned session', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-tui-policy-')));
    mkdirSync(join(home, '.robota'));
    writeFileSync(join(home, '.robota', 'org-policy.json'), JSON.stringify(POLICY));
    vi.stubEnv('HOME', home);
    let channel: TuiInteractionChannel | undefined;
    try {
      const policy = loadOrgPolicy(join(home, '.robota', 'org-policy.json'));
      expect(policy).not.toBeNull();
      channel = new TuiInteractionChannel(
        toChannelOptions(renderOptions({ cwd: home, orgPolicy: policy ?? undefined })),
      );

      const result = await channel.getSession().executeCommand('clear', '');

      expect(result?.success).toBe(false);
      expect(result?.message).toContain('Command /clear is blocked');
      expect(result?.message).toContain('ops@x');
    } finally {
      await channel?.stop();
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  });
});

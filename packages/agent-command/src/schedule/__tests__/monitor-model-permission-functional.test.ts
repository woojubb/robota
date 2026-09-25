/**
 * A model-requested `/monitor` starts its command as a process, so the command is decided by the
 * shell tool's own gate — the user's Bash/Shell rules — never by consent to `/monitor` itself.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createScheduleCommandModule } from '../schedule-command-module.js';

import type { TPermissionMode } from '@robota-sdk/agent-core';

let harness: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

function session(options: {
  permissionMode: TPermissionMode;
  permissions: { allow?: string[]; deny?: string[] };
}): ScriptedSessionHarness {
  harness = scriptedSession({
    turns: [],
    commandModules: [createScheduleCommandModule()],
    backgroundTasks: true,
    ...options,
  });
  return harness;
}

const MONITOR_ARGS = '"sleep 30" "ready" check the server';

function monitorTasks(h: ScriptedSessionHarness) {
  return h.session.listBackgroundTasks().filter((task) => task.kind === 'process');
}

describe('/monitor from the model is decided by the shell gate', () => {
  it('a Bash deny rule refuses the monitored command, even under bypassPermissions', async () => {
    const h = session({
      permissionMode: 'bypassPermissions',
      permissions: { deny: ['Bash(sleep *)'] },
    });

    const result = await h.session.executeModelCommand('monitor', MONITOR_ARGS);

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('shell permission rules refused this command');
    expect(monitorTasks(h)).toEqual([]);
  });

  it('an allow rule for a different command does not approve it', async () => {
    // Plan mode refuses an execute call no allow rule matches, so a prompt cannot stand in for it.
    const h = session({ permissionMode: 'plan', permissions: { allow: ['Bash(echo *)'] } });

    const result = await h.session.executeModelCommand('monitor', MONITOR_ARGS);

    expect(result?.success).toBe(false);
    expect(monitorTasks(h)).toEqual([]);
  });

  it('starts the monitor when the shell rules allow that command', async () => {
    const h = session({ permissionMode: 'plan', permissions: { allow: ['Bash(sleep *)'] } });

    const result = await h.session.executeModelCommand('monitor', MONITOR_ARGS);

    expect(result?.success).toBe(true);
    expect(monitorTasks(h)).toHaveLength(1);
  });

  it('leaves the user-typed command to the user', async () => {
    const h = session({
      permissionMode: 'bypassPermissions',
      permissions: { deny: ['Bash(sleep *)'] },
    });

    const result = await h.command('monitor', MONITOR_ARGS);

    expect(result?.success).toBe(true);
  });
});

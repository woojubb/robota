/**
 * Issue #3242: a print run consults the same sandbox the shell tools run under, so a confined
 * command the sandbox approves runs without a prompt — the TUI and serve behaviour.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { HeadlessInteractionChannel } from '../HeadlessInteractionChannel.js';

import type { ISandboxClient } from '@robota-sdk/agent-tools';

/** A sandbox that confines every command and lets each one run without a prompt. */
const autoApprovingSandbox: ISandboxClient = {
  filesystem: 'shared',
  wrapCommand: (invocation) => invocation,
  autoApproves: () => true,
  run: () => Promise.reject(new Error('not used')),
  readFile: () => Promise.reject(new Error('not used')),
  writeFile: () => Promise.reject(new Error('not used')),
};

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});

function silenceStdout(): void {
  const original = process.stdout.write;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  cleanup.push(() => {
    process.stdout.write = original;
  });
}

async function runBashInPrintMode(sandboxClient?: ISandboxClient): Promise<string[]> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-headless-sandbox-')));
  cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
  const ran: string[] = [];
  const bash = new FunctionTool(
    {
      name: 'Bash',
      description: 'Run a shell command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
    async (args) => {
      ran.push(String(args.command));
      return 'done';
    },
  );
  const channel = new HeadlessInteractionChannel({
    cwd,
    provider: createScriptedProvider([
      { toolCalls: [{ name: 'Bash', args: { command: 'npm test' } }] },
      { text: 'finished' },
    ]).provider,
    outputFormat: 'text',
    shellExec: () => '',
    bare: true,
    permissionMode: 'default',
    defaultTools: [],
    additionalTools: [bash],
    ...(sandboxClient !== undefined ? { sandboxClient } : {}),
  });
  silenceStdout();
  await channel.run('run the tests');
  return ran;
}

describe('HeadlessInteractionChannel sandbox approval', () => {
  it('runs a command the sandbox confines and approves, with no one to ask', async () => {
    expect(await runBashInPrintMode(autoApprovingSandbox)).toEqual(['npm test']);
  });

  it('without a sandbox, the same command is not run unattended', async () => {
    expect(await runBashInPrintMode()).toEqual([]);
  });
});

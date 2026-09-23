import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createSessionEventRenderingProjectAccess } from './session-event-rendering-project-access.js';
import { TuiInteractionChannel } from '../src/index.js';

const PROMPT = 'verify the bounded TUI channel';
const RESPONSE = 'bounded channel response';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function waitForCompletion(channel: TuiInteractionChannel): Promise<void> {
  const session = channel.getSession();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for the TUI turn')), 5_000);
    session.on('complete', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const scenarioRoot = mkdtempSync(join(tmpdir(), 'refactor-025-tui-'));
  const workspace = join(scenarioRoot, 'workspace');
  mkdirSync(workspace);
  const cwd = realpathSync(workspace);
  writeFileSync(join(cwd, 'AGENTS.md'), '# Scenario workspace\n', 'utf8');
  const scripted = createScriptedProvider([{ text: RESPONSE }]);
  const projectAccess = await createSessionEventRenderingProjectAccess(scenarioRoot);
  assertCondition(projectAccess.status === 'trusted', 'scenario project access was not trusted');
  const channel = new TuiInteractionChannel({
    cwd,
    provider: scripted.provider,
    projectAccess,
    sessionName: 'REFACTOR-025 scenario',
  });

  try {
    await channel.start();
    const completed = waitForCompletion(channel);
    await channel.handleInput(PROMPT);
    await completed;
    const transcript = JSON.stringify(channel.getSnapshot().history);
    assertCondition(scripted.requests.length === 1, 'scripted provider did not consume one turn');
    assertCondition(transcript.includes(PROMPT), 'user prompt did not reach TUI history');
    assertCondition(transcript.includes(RESPONSE), 'assistant response did not reach TUI history');
    process.stdout.write('result=REFACTOR_025_BOUNDARY_PASS\n');
  } finally {
    await channel.stop();
    rmSync(scenarioRoot, { recursive: true, force: true });
  }
}

await main();

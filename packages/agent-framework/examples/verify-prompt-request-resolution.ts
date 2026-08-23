import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { InteractiveSession } from '../src/index.js';

import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
} from '@robota-sdk/agent-interface-session';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function completeTurn(session: InteractiveSession, prompt: string): Promise<string> {
  const handle = await session.submit(prompt);
  return (await handle.completed).response;
}

function readAskAnswer(session: InteractiveSession): string[] {
  const entry = session
    .getFullHistory()
    .find(
      (candidate) =>
        candidate.type === 'tool-end' &&
        (candidate.data as { toolName?: string } | undefined)?.toolName === 'AskUserQuestion',
    );
  const data = (entry?.data as { toolResultData?: string } | undefined)?.toolResultData;
  assertCondition(data !== undefined, 'AskUserQuestion did not produce a tool result');
  const invocation = JSON.parse(data) as { success: boolean; output: string };
  assertCondition(invocation.success, 'AskUserQuestion tool invocation failed');
  const result = JSON.parse(invocation.output) as {
    answers: Array<{ values?: string[] }>;
  };
  return result.answers[0]?.values ?? [];
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-017-example-'));
  const markerPath = join(cwd, 'permission-allowed.txt');
  const script = createScriptedProvider([
    {
      toolCalls: [
        {
          name: 'Bash',
          args: { command: `printf ARCH_017_ALLOWED > ${JSON.stringify(markerPath)}` },
        },
      ],
    },
    { text: 'permission complete' },
    {
      toolCalls: [
        {
          name: 'AskUserQuestion',
          args: {
            questions: [
              {
                question: 'Which canonical answer?',
                options: [{ label: 'registry' }, { label: 'legacy-handler' }],
              },
            ],
          },
        },
      ],
    },
    { text: 'ask complete' },
  ]);
  const session = new InteractiveSession({
    cwd,
    provider: script.provider,
    bare: true,
    permissionMode: 'default',
  });
  const permissionRequests: IPermissionRequestEvent[] = [];
  const askRequests: IAskRequestEvent[] = [];
  const resolved: IPromptResolvedEvent[] = [];
  let result:
    | {
        requestEvents: string[];
        permissionRequestCount: number;
        askRequestCount: number;
        resolvedRequestIds: string[];
        allowedToolResult: string;
        askAnswer: string[];
        responses: string[];
      }
    | undefined;

  session.on('permission_request', (event) => {
    permissionRequests.push(event);
    session.resolvePermission(event.id, true);
  });
  session.on('ask_request', (event) => {
    askRequests.push(event);
    session.resolveAsk(event.id, { type: 'answer', values: ['registry'] });
  });
  session.on('prompt_resolved', (event) => resolved.push(event));

  try {
    const responses = [
      await completeTurn(session, 'run the permission-gated tool'),
      await completeTurn(session, 'ask the structured question'),
    ];
    assertCondition(permissionRequests.length === 1, 'expected one permission_request');
    assertCondition(askRequests.length === 1, 'expected one ask_request');
    assertCondition(resolved.length === 2, 'expected exactly two prompt_resolved events');
    assertCondition(
      resolved[0]?.id === permissionRequests[0]?.id && resolved[1]?.id === askRequests[0]?.id,
      'prompt_resolved ids did not match their canonical request ids',
    );
    assertCondition(existsSync(markerPath), 'allowed Bash tool did not create its marker');
    const allowedToolResult = readFileSync(markerPath, 'utf8');
    const askAnswer = readAskAnswer(session);
    assertCondition(
      allowedToolResult === 'ARCH_017_ALLOWED',
      'allowed tool result was not observed',
    );
    assertCondition(askAnswer[0] === 'registry', 'ask answer was not observed by the tool caller');

    result = {
      requestEvents: ['permission_request', 'ask_request', 'prompt_resolved'],
      permissionRequestCount: permissionRequests.length,
      askRequestCount: askRequests.length,
      resolvedRequestIds: resolved.map((event) => event.id),
      allowedToolResult,
      askAnswer,
      responses,
    };
  } finally {
    await session.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(
    `${JSON.stringify({ scenario: 'ARCH-017', ...result, cleanupRemoved: true })}\n`,
  );
}

await main();

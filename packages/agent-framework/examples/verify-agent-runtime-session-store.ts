import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import {
  createAgentRuntime,
  createNodeHostSessionStore,
  type InteractiveSession,
} from '../src/index.js';

const FIRST_PROMPT = 'ARCH-023 remember runtime-default-store';
const FIRST_RESPONSE = 'ARCH-023 stored runtime-default-store';
const SECOND_PROMPT = 'ARCH-023 recall runtime-default-store';
const SECOND_RESPONSE = 'ARCH-023 restored runtime-default-store';

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function completeTurn(session: InteractiveSession, prompt: string): Promise<string> {
  const handle = await session.submit(prompt);
  return (await handle.completed).response;
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'arch-023-example-'));
  let firstSession: InteractiveSession | undefined;
  let secondSession: InteractiveSession | undefined;
  let result:
    | {
        firstResponse: string;
        resumedResponse: string;
        sameSessionId: boolean;
        resumedProviderRequest: {
          priorUserPromptPresent: boolean;
          priorAssistantReplyPresent: boolean;
          currentPromptPresent: boolean;
        };
        resumedHistory: { messageCount: number; roles: string[] };
      }
    | undefined;

  try {
    const sessionStore = createNodeHostSessionStore(join(cwd, '.robota', 'sessions'));
    const firstScript = createScriptedProvider([{ text: FIRST_RESPONSE }]);
    const firstRuntime = createAgentRuntime({
      cwd,
      provider: firstScript.provider,
      sessionStore,
    });
    firstSession = firstRuntime.createSession({});
    const firstResponse = await completeTurn(firstSession, FIRST_PROMPT);
    const sessionId = firstSession.getSession().getSessionId();
    await firstSession.shutdown();

    assertCondition(firstResponse === FIRST_RESPONSE, 'first response did not match the script');
    assertCondition(
      existsSync(join(cwd, '.robota', 'sessions', `${sessionId}.json`)),
      'runtime default store did not persist the first session record',
    );

    const secondScript = createScriptedProvider([{ text: SECOND_RESPONSE }]);
    const secondRuntime = createAgentRuntime({
      cwd,
      provider: secondScript.provider,
      sessionStore,
    });
    secondSession = secondRuntime.createSession({ resumeSessionId: sessionId });
    const resumedResponse = await completeTurn(secondSession, SECOND_PROMPT);

    const requestContents = (secondScript.requests[0] ?? []).map((message) =>
      String(message.content),
    );
    const priorUserPromptPresent = requestContents.includes(FIRST_PROMPT);
    const priorAssistantReplyPresent = requestContents.includes(FIRST_RESPONSE);
    const currentPromptPresent = requestContents.includes(SECOND_PROMPT);
    const messages = secondSession.getMessages();
    const roles = messages.map((message) => message.role);
    const sameSessionId = secondSession.getSession().getSessionId() === sessionId;

    assertCondition(
      resumedResponse === SECOND_RESPONSE,
      'resumed response did not match the script',
    );
    assertCondition(sameSessionId, 'resume did not retain the original session id');
    assertCondition(
      priorUserPromptPresent,
      'resumed provider request omitted the prior user prompt',
    );
    assertCondition(
      priorAssistantReplyPresent,
      'resumed provider request omitted the prior assistant reply',
    );
    assertCondition(currentPromptPresent, 'resumed provider request omitted the current prompt');
    assertCondition(messages.length === 4, 'resumed public history did not contain four messages');
    assertCondition(
      roles.join(',') === 'user,assistant,user,assistant',
      'resumed public history roles were out of order',
    );

    result = {
      firstResponse,
      resumedResponse,
      sameSessionId,
      resumedProviderRequest: {
        priorUserPromptPresent,
        priorAssistantReplyPresent,
        currentPromptPresent,
      },
      resumedHistory: { messageCount: messages.length, roles },
    };
  } finally {
    await Promise.allSettled([firstSession?.shutdown(), secondSession?.shutdown()]);
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(
    `${JSON.stringify({ scenario: 'ARCH-023', ...result, cleanupRemoved: true })}\n`,
  );
}

await main();

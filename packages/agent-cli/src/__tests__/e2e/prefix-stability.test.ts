/**
 * The part of a request that a provider's prompt cache keys on is its prefix: the tools, the system
 * prompt, then the history. In one session in a detected project, every call must send the same
 * tools and the same system prompt and extend the previous call's history, so that a cache
 * breakpoint written by one call is read by the next. Nothing in the prefix may change from one
 * call to the next unless a context file the prompt embeds changed.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { createTestProductRuntime } from '../helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';

import type { IProviderDefinition, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IScriptedProvider, TScriptedTurn } from '@robota-sdk/agent-core/testing';

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

let base: string;
let home: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-prefix-')));
  home = join(base, 'home');
  project = join(base, 'project');
  mkdirSync(join(home, '.test-product'), { recursive: true });
  writeFileSync(
    join(home, '.test-product', 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
  );
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'probe-app' }));
  writeFileSync(join(project, 'tsconfig.json'), '{}');
  writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 8\n');
  writeFileSync(join(project, 'AGENTS.md'), '# Project guidance\n\nPrefer small functions.\n');
  process.env.HOME = home;
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code ?? 0)}`);
  }) as never);
});

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  process.env.HOME = ORIGINAL_HOME;
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

/** Run the CLI in the project with a scripted provider; resolves when the process would exit. */
async function runGoal(
  turns: readonly TScriptedTurn[],
  extra: readonly string[] = [],
  beforeCall: (callNumber: number) => void = () => undefined,
): Promise<IScriptedProvider> {
  const scripted = createScriptedProvider(turns);
  const answer = scripted.provider.chat.bind(scripted.provider);
  let callNumber = 0;
  scripted.provider.chat = (messages, options) => {
    callNumber += 1;
    beforeCall(callNumber);
    return answer(messages, options);
  };
  process.argv = [
    'node',
    'test-product',
    '--goal',
    'inspect the project and report',
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    ...extra,
  ];
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
  try {
    await startCli({
      productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      providerDefinitions: [scriptedDefinition(scripted)],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    });
  } catch (error) {
    if (!/^process\.exit:\d+$/.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  return scripted;
}

function systemOf(messages: readonly TUniversalMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content ?? ''))
    .join('\n\n');
}

/** What a message contributes to the prefix, without the identity and timing fields. */
function historyShape(messages: readonly TUniversalMessage[]): string[] {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) =>
      JSON.stringify({
        role: message.role,
        content: message.content,
        toolCalls: (message as { toolCalls?: unknown }).toolCalls,
        toolCallId: (message as { toolCallId?: unknown }).toolCallId,
      }),
    );
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

interface IPairReport {
  readonly call: number;
  readonly sameSystem: boolean;
  readonly systemSharedPrefix: number;
  readonly systemLength: number;
  readonly sameTools: boolean;
  readonly historyExtendsPrevious: boolean;
}

function report(scripted: IScriptedProvider): IPairReport[] {
  const pairs: IPairReport[] = [];
  for (let call = 1; call < scripted.requests.length; call += 1) {
    const previous = scripted.requests[call - 1] ?? [];
    const current = scripted.requests[call] ?? [];
    const previousSystem = systemOf(previous);
    const currentSystem = systemOf(current);
    const previousHistory = historyShape(previous);
    const currentHistory = historyShape(current);
    pairs.push({
      call: call + 1,
      sameSystem: previousSystem === currentSystem,
      systemSharedPrefix: commonPrefixLength(previousSystem, currentSystem),
      systemLength: currentSystem.length,
      sameTools:
        JSON.stringify(scripted.chatOptions[call - 1]?.tools) ===
        JSON.stringify(scripted.chatOptions[call]?.tools),
      historyExtendsPrevious: previousHistory.every(
        (entry, index) => currentHistory[index] === entry,
      ),
    });
  }
  return pairs;
}

const goalScript = (target: string): TScriptedTurn[] => [
  { toolCalls: [{ name: 'Read', args: { filePath: target } }] },
  { toolCalls: [{ name: 'report_goal_status', args: { status: 'continue', reason: 'one more' } }] },
  { text: 'first pass done' },
  { toolCalls: [{ name: 'Read', args: { filePath: target } }] },
  { toolCalls: [{ name: 'report_goal_status', args: { status: 'satisfied', reason: 'done' } }] },
  { text: 'goal complete' },
];

describe('request prefix stability in one session of a detected project', () => {
  it('sends the same tools and system prompt on every call and extends the previous history', async () => {
    const scripted = await runGoal(goalScript(join(project, 'package.json')));

    expect(scripted.requests.length).toBeGreaterThanOrEqual(5);
    // The project was detected: the section under test is present and not empty.
    expect(systemOf(scripted.requests[0] ?? [])).toContain('- **Name:** probe-app');

    for (const pair of report(scripted)) {
      expect(pair, `call ${pair.call}`).toMatchObject({
        sameSystem: true,
        sameTools: true,
        historyExtendsPrevious: true,
      });
    }
  });

  it('changes the system prompt only from the context file that changed', async () => {
    const guidance = join(project, 'AGENTS.md');
    const scripted = await runGoal([
      {
        toolCalls: [
          {
            name: 'Write',
            args: { filePath: guidance, content: '# Project guidance\n\nPrefer tiny functions.\n' },
          },
        ],
      },
      {
        toolCalls: [{ name: 'report_goal_status', args: { status: 'continue', reason: 'edited' } }],
      },
      { text: 'edited the guidance' },
      {
        toolCalls: [{ name: 'report_goal_status', args: { status: 'satisfied', reason: 'done' } }],
      },
      { text: 'goal complete' },
    ]);

    const first = systemOf(scripted.requests[0] ?? []);
    const last = systemOf(scripted.requests.at(-1) ?? []);
    expect(last).toContain('Prefer tiny functions.');
    expect(first).toContain('Prefer small functions.');
    // Everything the edit did not touch is byte-identical: the two prompts differ only inside the file's text.
    const shared = commonPrefixLength(first, last);
    expect(first.slice(shared).replace('small', 'tiny')).toBe(last.slice(shared));
  });
});

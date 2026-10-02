/** Real built CLI TUI on a PTY, isolated product state and an owned synthetic model endpoint. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnPty } from '../../../packages/agent-ui-terminal/src/__tests__/pty/spawn-pty.ts';
import { fixtureProductEnvironment } from '../../../packages/agent-ui-terminal/src/__tests__/pty/isolated-home.ts';
import type { IPtyRunSession } from '../../../packages/agent-ui-terminal/src/__tests__/pty/spawn-pty.ts';
const output = process.argv[2];
assert(output, 'Provide a report JSON path');
const records: { id: string; observed: unknown; passed: boolean }[] = [];
const record = async (id: string, observed: unknown, passed: boolean) => {
  records.push({ id, observed, passed });
  await writeFile(
    output,
    JSON.stringify({ kind: 'actual-built-cli-tui-pty', records, complete: false }, null, 2) + '\n',
  );
  assert(passed, id);
};
const root = await mkdtemp(join(tmpdir(), 'issue-2-tui-'));
const home = join(root, 'home');
const state = join(home, 'state');
await mkdir(state, { recursive: true });
const marker = `RESEARCH_TUI_RESPONSE_${randomUUID().replaceAll('-', '')}`;
const prompt = `RESEARCH_TUI_PROMPT_${randomUUID().replaceAll('-', '')}`;
let requests = 0;
let matchingRequests = 0;
const model = createServer(async (req, res) => {
  requests++;
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (
    !Array.isArray(body?.messages) ||
    !body.messages.some(
      (message: { role: string; content: unknown }) =>
        message?.role === 'user' && String(message.content).includes(prompt),
    )
  ) {
    res.writeHead(400).end();
    return;
  }
  matchingRequests++;
  const response = {
    id: 'chatcmpl-synthetic-tui',
    object: 'chat.completion',
    created: 0,
    model: 'synthetic',
    choices: [{ index: 0, message: { role: 'assistant', content: marker }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [delta, finish] of [
      [{ role: 'assistant', content: marker }, null],
      [{}, 'stop'],
    ]) {
      res.write(
        `data: ${JSON.stringify({
          id: response.id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'synthetic',
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    }
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
  }
});
let session: IPtyRunSession | undefined;
let stopped = false;
try {
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const address = model.address();
  assert(address && typeof address !== 'string');
  const cli = fileURLToPath(
    new URL('../../../packages/agent-cli/dist/node/bin.js', import.meta.url),
  );
  const cliEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TERM: 'xterm-256color',
    ...fixtureProductEnvironment(home),
    RESEARCH_FAKE_MODEL_KEY: 'synthetic-non-secret',
  };
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  execFileSync(
    process.execPath,
    [
      cli,
      '--configure-provider',
      'fixture',
      '--type',
      'openai',
      '--base-url',
      baseURL,
      '--model',
      'synthetic',
      '--api-key-env',
      'RESEARCH_FAKE_MODEL_KEY',
      '--set-current',
    ],
    { cwd: root, env: cliEnv, stdio: 'ignore' },
  );
  const configured = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
  assert(
    configured.providers.fixture.baseURL === baseURL,
    'Synthetic provider endpoint was not persisted',
  );
  session = spawnPty({
    command: process.execPath,
    cwd: root,
    env: cliEnv,
    args: [cli, '--name', 'synthetic-research-tui', '--no-session-persistence'],
    cols: 120,
    rows: 40,
  });
  await session.waitFor(/Type a message or \/help/);
  await session.waitFor(/Idle/);
  await record(
    'actual-tui-boot-and-idle',
    { rendered: true, modelRequests: requests },
    requests === 0,
  );
  await session.sendKeys('/help');
  const helpMark = session.outputOffset();
  await session.pressEnter();
  await session.waitForSince(helpMark, /Available commands:/);
  await record(
    'slash-help-no-model-request',
    { commandOutputAfterEnter: true, modelRequests: requests },
    requests === 0,
  );
  const beforeInjected = requests;
  const injected = await fetch(baseURL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '/help' }] }),
  });
  await record(
    'invalid-model-request-negative-control',
    {
      status: injected.status,
      requestDelta: requests - beforeInjected,
      noRequestPredicate: requests === beforeInjected,
    },
    injected.status === 400 && requests - beforeInjected === 1 && requests !== beforeInjected,
  );
  const turnStart = requests;
  await session.sendKeys(prompt);
  const promptMark = session.outputOffset();
  await session.pressEnter();
  await session.waitForSince(promptMark, marker);
  await record(
    'real-tui-model-turn',
    {
      uniqueResponseRendered: true,
      modelRequests: requests - turnStart,
      matchingPromptRequests: matchingRequests,
      markerWasNotInput: !prompt.includes(marker),
    },
    requests - turnStart === 1 && matchingRequests === 1 && !prompt.includes(marker),
  );
  await session.sendKeys('/exit');
  const exitMark = session.outputOffset();
  await session.pressEnter();
  await session.waitForSince(exitMark, /Exit the session\?/);
  await session.pressEnter();
  const code = await session.expectExit(10000);
  stopped = true;
  await record('confirmed-tui-exit', { exitCode: code }, code === 0);
  const config = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
  await record(
    'isolated-product-state-selected',
    { temporaryStatePresent: true, configuredSyntheticProvider: config.currentProvider },
    config.currentProvider === 'fixture',
  );
} finally {
  try {
    if (session && !stopped) {
      session.dispose();
      await session.expectExit(15000);
      stopped = true;
    }
  } finally {
    model.closeAllConnections();
    if (model.listening)
      await new Promise<void>((resolve, reject) =>
        model.close((error) => (error ? reject(error) : resolve())),
      );
    if (!session || stopped) await rm(root, { recursive: true, force: true });
  }
}
await record(
  'owned-tui-model-and-state-cleanup',
  {
    terminalExited: stopped,
    modelStopped: !model.listening,
    temporaryStateRemoved: !existsSync(root),
  },
  stopped && !model.listening && !existsSync(root),
);
await writeFile(
  output,
  JSON.stringify(
    {
      kind: 'actual-built-cli-tui-pty',
      records,
      complete: true,
      limitations: [
        'PTY uses the actual built CLI and existing test-only terminal driver; this is Linux terminal observation, not Electron or macOS UI evidence.',
        'The owned loopback model is deterministic. One plain-text turn and user slash commands do not prove model attack resistance, hosted isolation or tool execution containment.',
      ],
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`${records.length} actual TUI/PTY observations passed\n`);
